/** Rules shared by the Apps Script relay and the edge function. No network. */

export const DRIVE_ROOTS = ["KioskOps/Photo audits", "KioskOps/Receipts", "KioskOps/Backups"] as const;

export type DriveKind = "photo_audit" | "receipt" | "backup";

const FILE_ID = /^[A-Za-z0-9_-]{10,128}$/;
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_TEXT = /^[0-9a-f]{64}$/;

export const MAX_RELAY_BYTES = 2_000_000;

export function driveFileIdOk(value: string | null | undefined): boolean {
  return Boolean(value && FILE_ID.test(value));
}

export function folderPart(value: string): string | null {
  const clean = value.trim();
  if (!clean || clean.length > 80 || clean === "." || clean === ".." || /[\\/]/.test(clean)) return null;
  return clean;
}

export function driveFolderFor(kind: DriveKind, parts: string[]): string | null {
  const clean = parts.map((part) => folderPart(part));
  if (clean.some((part) => part == null)) return null;
  const names = clean as string[];
  if (kind === "photo_audit" && names.length === 2) return `${DRIVE_ROOTS[0]}/${names[0]}/${names[1]}`;
  if (kind === "receipt" && names.length === 2) return `${DRIVE_ROOTS[1]}/${names[0]}/${names[1]}`;
  if (kind === "backup" && names.length === 1) return `${DRIVE_ROOTS[2]}/${names[0]}`;
  return null;
}

/** Folder comes from the signed-in person, the visit date, and the site. Caller path parts are not accepted. */
export function serverFolder(kind: "photo_audit" | "receipt", person: string, day: string, site: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const who = folderPart(person);
  const where = folderPart(site);
  if (!who || !where) return null;
  return driveFolderFor(kind, [who, `${day}-${where}`]);
}

export function contentKey(shotId: string, version: number, sha: string): string | null {
  if (!UUID_TEXT.test(shotId) || !Number.isInteger(version) || version < 1 || version > 100000 || !SHA256_TEXT.test(sha)) return null;
  return `${shotId}.${version}.${sha}`;
}

export function decodeBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length === 0 || value.length % 4 !== 0) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function jpegBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Apps Script doPost receives queryString, parameter, parameters, and postData.
 * It does not receive request headers. A token that exists only on a header is ignored.
 */
export function authorizeRelay(
  event: { postData?: { contents?: string }; headers?: unknown },
  expectedToken: string | null,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  if (!expectedToken) return { ok: false, error: "Not allowed." };
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(event.postData?.contents || "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "Missing details." };
    body = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Missing details." };
  }
  const presented = typeof body.relayToken === "string" ? body.relayToken : "";
  if (presented !== expectedToken) return { ok: false, error: "Not allowed." };
  return { ok: true, body };
}

export type MemoryFile = { id: string; description: string; byteLength: number };

export function createScriptLock() {
  let chain = Promise.resolve();
  return {
    exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
      const previous = chain;
      let release = () => {};
      chain = new Promise<void>((resolve) => {
        release = resolve;
      });
      return previous.then(async () => {
        try {
          return await fn();
        } finally {
          release();
        }
      });
    },
  };
}

/** Find-or-create under one lock. A new content key does not reuse an older file. */
export function commitLockedFile(
  lock: ReturnType<typeof createScriptLock>,
  store: { files: MemoryFile[]; next: number },
  key: string,
  byteLength: number,
): Promise<{ fileId: string; replayed: boolean }> {
  return lock.exclusive(() => {
    const description = `kioskops:${key}`;
    const existing = store.files.find((file) => file.description === description);
    if (existing) return { fileId: existing.id, replayed: true };
    const id = `file${String(store.next).padStart(12, "0")}`;
    store.next += 1;
    store.files.push({ id, description, byteLength });
    return { fileId: id, replayed: false };
  });
}

export function freezeFailureBlocksQueue(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST202") return false;
  const message = error.message ?? "";
  if (/could not find the function|schema cache|does not exist/i.test(message) && /freeze_photo_audit/i.test(message)) return false;
  return true;
}
