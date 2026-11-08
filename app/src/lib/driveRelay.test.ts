import { describe, expect, it } from "vitest";
import { driveFileIdOk, driveFolderFor, freezeFailureBlocksQueue } from "../../../supabase/functions/_shared/driveRelay";

describe("drive relay rules", () => {
  it("allows only the three KioskOps folders and rejects path tricks", () => {
    expect(driveFolderFor("photo_audit", ["Ada", "2026-11-08-Sinai"])).toBe("KioskOps/Photo audits/Ada/2026-11-08-Sinai");
    expect(driveFolderFor("receipt", ["Ada", "2026-11-08-Sinai"])).toBe("KioskOps/Receipts/Ada/2026-11-08-Sinai");
    expect(driveFolderFor("backup", ["2026-11-08"])).toBe("KioskOps/Backups/2026-11-08");
    expect(driveFolderFor("photo_audit", ["..", "secrets"])).toBeNull();
    expect(driveFolderFor("backup", ["a/b"])).toBeNull();
    expect(driveFileIdOk("abc_DEF-1234567890")).toBe(true);
    expect(driveFileIdOk("../secret")).toBe(false);
    expect(driveFileIdOk("short")).toBe(false);
  });

  it("retries a missing photo-audit freeze and does not hide a real rejection", () => {
    expect(freezeFailureBlocksQueue({ code: "PGRST202", message: "freeze_photo_audit" })).toBe(false);
    expect(freezeFailureBlocksQueue({ message: "Practice cannot change a live visit." })).toBe(true);
  });
});
