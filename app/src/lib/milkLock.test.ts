import { describe, expect, it } from "vitest";
import {
  MILK_LOCK_FULL,
  MILK_LOCK_NOT_NEEDED_OK,
  milkCleanRunning,
  milkStepLocks,
} from "./milkLock";

const started = "2026-11-05T15:00:00Z";
const startMs = new Date(started).getTime();

describe("milk timer", () => {
  it("is running until the model minutes elapse", () => {
    expect(milkCleanRunning(started, null, 11, startMs + 10 * 60_000)).toBe(true);
    expect(milkCleanRunning(started, null, 11, startMs + 11 * 60_000)).toBe(false);
  });

  it("stops when cleaning is marked done, even if the clock has time left", () => {
    expect(milkCleanRunning(started, "2026-11-05T15:05:00Z", 11, startMs + 60_000)).toBe(false);
  });
});

describe("steps locked while milk cleaning runs", () => {
  const prep = ["fill_beans", "empty_pucks", "cleaning_balls", "long_water"];

  it("keeps Done locked on Wipe the Cameo and leaves Not needed available", () => {
    expect(milkStepLocks({ key: "wipe_cameo", lockedDuringClean: true }, true)).toEqual({
      doneLocked: true,
      notNeededLocked: false,
      message: MILK_LOCK_NOT_NEEDED_OK,
    });
  });

  it("keeps both buttons locked on prep steps that would interrupt the cleaning", () => {
    for (const key of prep) {
      expect(milkStepLocks({ key, lockedDuringClean: true }, true)).toEqual({
        doneLocked: true,
        notNeededLocked: true,
        message: MILK_LOCK_FULL,
      });
    }
  });

  it("unlocks Done after the timer, including a switch from Not needed", () => {
    expect(milkStepLocks({ key: "wipe_cameo", lockedDuringClean: true }, false)).toEqual({
      doneLocked: false,
      notNeededLocked: false,
      message: null,
    });
  });

  it("does not lock steps that are not tied to the timer", () => {
    expect(milkStepLocks({ key: "glass", lockedDuringClean: false }, true).doneLocked).toBe(false);
  });
});
