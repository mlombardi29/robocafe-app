import { describe, expect, it } from "vitest";
import {
  IP_MAX_FAILS,
  PIN_LOCK_MS,
  PIN_MAX_FAILS,
  ipBlocked,
  minutesLeft,
  normalizeLock,
  pinError,
  registerFailure,
} from "../../../supabase/functions/_shared/pinPolicy";

describe("PIN lockout", () => {
  const start = Date.parse("2026-11-09T15:00:00Z");

  it("locks on the 5th failure for 15 minutes", () => {
    let state = { failedCount: 0, lockedUntil: null as number | null };
    for (let i = 0; i < PIN_MAX_FAILS - 1; i += 1) {
      state = registerFailure(state, start);
      expect(state.lockedUntil).toBeNull();
    }
    state = registerFailure(state, start);
    expect(state.failedCount).toBe(5);
    expect(state.lockedUntil).toBe(start + PIN_LOCK_MS);
    expect(minutesLeft(state.lockedUntil ?? 0, start + 60_000)).toBe(14);
  });

  it("clears an expired lock before the next try", () => {
    const locked = { failedCount: 5, lockedUntil: start };
    expect(normalizeLock(locked, start - 1).lockedUntil).toBe(start);
    expect(normalizeLock(locked, start).failedCount).toBe(0);
    expect(normalizeLock(locked, start + 1).failedCount).toBe(0);
  });

  it("blocks an address after 20 failures in the window", () => {
    expect(ipBlocked(IP_MAX_FAILS - 1)).toBe(false);
    expect(ipBlocked(IP_MAX_FAILS)).toBe(true);
  });

  it("accepts 4 to 6 digits and rejects easy PINs", () => {
    expect(pinError("4821")).toBeNull();
    expect(pinError("48219")).toBeNull();
    expect(pinError("482193")).toBeNull();
    expect(pinError("123")).toMatch(/4 to 6/);
    expect(pinError("1234567")).toMatch(/4 to 6/);
    expect(pinError("12a4")).toMatch(/4 to 6/);
    expect(pinError("1111")).toMatch(/same digit/);
    expect(pinError("000000")).toMatch(/same digit/);
    expect(pinError("1234")).toMatch(/easy/);
    expect(pinError("12345")).toMatch(/easy/);
    expect(pinError("123456")).toMatch(/easy/);
    expect(pinError("0000")).toMatch(/same digit/);
  });
});
