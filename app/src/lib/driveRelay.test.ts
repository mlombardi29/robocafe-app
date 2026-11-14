import { describe, expect, it } from "vitest";
import {
  authorizeRelay,
  commitLockedFile,
  contentKey,
  createScriptLock,
  decodeBase64,
  driveFileIdOk,
  driveFolderFor,
  freezeFailureBlocksQueue,
  jpegBytes,
  serverFolder,
  sha256Hex,
} from "../../../supabase/functions/_shared/driveRelay";

describe("drive relay rules", () => {
  it("allows only the three KioskOps folders and rejects path tricks", () => {
    expect(driveFolderFor("photo_audit", ["Ada", "2026-11-08-Sinai"])).toBe("KioskOps/Photo audits/Ada/2026-11-08-Sinai");
    expect(driveFolderFor("receipt", ["Ada", "2026-11-08-Sinai"])).toBe("KioskOps/Receipts/Ada/2026-11-08-Sinai");
    expect(driveFolderFor("backup", ["2026-11-08"])).toBe("KioskOps/Backups/2026-11-08");
    expect(driveFolderFor("photo_audit", ["..", "secrets"])).toBeNull();
    expect(driveFolderFor("backup", ["a/b"])).toBeNull();
    expect(serverFolder("photo_audit", "Ada", "2026-11-08", "Sinai")).toBe("KioskOps/Photo audits/Ada/2026-11-08-Sinai");
    expect(serverFolder("photo_audit", "../Ada", "2026-11-08", "Sinai")).toBeNull();
    expect(driveFileIdOk("abc_DEF-1234567890")).toBe(true);
    expect(driveFileIdOk("../secret")).toBe(false);
    expect(driveFileIdOk("short")).toBe(false);
  });

  it("reads the relay token from the Apps Script post body and ignores a header", () => {
    const event = {
      parameter: {},
      parameters: {},
      queryString: "",
      contentLength: 10,
      postData: { contents: JSON.stringify({ relayToken: "expected-token", idempotencyKey: "abc" }), type: "application/json", length: 10 },
      headers: { "x-relay-token": "expected-token" },
    };
    expect(authorizeRelay({ postData: { contents: "{}" }, headers: { "x-relay-token": "expected-token" } }, "expected-token").ok).toBe(false);
    expect(authorizeRelay(event, "expected-token").ok).toBe(true);
    expect(authorizeRelay(event, null).ok).toBe(false);
  });

  it("binds a replacement to new bytes and does not reuse the first file under a lock", async () => {
    const shot = "11111111-1111-4111-8111-111111111111";
    const first = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const second = new Uint8Array([0xff, 0xd8, 0xff, 9, 8, 7, 6]);
    expect(jpegBytes(first)).toBe(true);
    const sha1 = await sha256Hex(first);
    const sha2 = await sha256Hex(second);
    expect(sha1).not.toBe(sha2);
    const key1 = contentKey(shot, 1, sha1);
    const key2 = contentKey(shot, 2, sha2);
    expect(key1).not.toBe(key2);
    const store = { files: [], next: 1 };
    const lock = createScriptLock();
    const [a, b] = await Promise.all([
      commitLockedFile(lock, store, key1!, first.length),
      commitLockedFile(lock, store, key1!, first.length),
    ]);
    expect(store.files).toHaveLength(1);
    expect(a.fileId).toBe(b.fileId);
    expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);
    const replaced = await commitLockedFile(lock, store, key2!, second.length);
    expect(replaced.fileId).not.toBe(a.fileId);
    expect(store.files).toHaveLength(2);
    expect(decodeBase64(btoa(String.fromCharCode(...first)))?.length).toBe(first.length);
  });

  it("retries a missing photo-audit freeze and does not hide a real rejection", () => {
    expect(freezeFailureBlocksQueue({ code: "PGRST202", message: "freeze_photo_audit" })).toBe(false);
    expect(freezeFailureBlocksQueue({ message: "Practice cannot change a live visit." })).toBe(true);
  });
});
