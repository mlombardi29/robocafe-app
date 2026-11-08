/** Rules shared by the Apps Script relay and the edge function. No network. */

export const DRIVE_ROOTS = ["KioskOps/Photo audits", "KioskOps/Receipts", "KioskOps/Backups"] as const;

export type DriveKind = "photo_audit" | "receipt" | "backup";

const FILE_ID = /^[A-Za-z0-9_-]{10,128}$/;

export function driveFileIdOk(value: string | null | undefined): boolean {
  return Boolean(value && FILE_ID.test(value));
}

export function driveFolderFor(kind: DriveKind, parts: string[]): string | null {
  const clean = parts.map((part) => part.trim()).filter(Boolean);
  if (clean.some((part) => part === "." || part === ".." || part.includes("/") || part.includes("\\"))) return null;
  if (kind === "photo_audit" && clean.length === 2) return `${DRIVE_ROOTS[0]}/${clean[0]}/${clean[1]}`;
  if (kind === "receipt" && clean.length === 2) return `${DRIVE_ROOTS[1]}/${clean[0]}/${clean[1]}`;
  if (kind === "backup" && clean.length === 1) return `${DRIVE_ROOTS[2]}/${clean[0]}`;
  return null;
}

export function freezeFailureBlocksQueue(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST202") return false;
  const message = error.message ?? "";
  if (/could not find the function|schema cache|does not exist/i.test(message) && /freeze_photo_audit/i.test(message)) return false;
  return true;
}
