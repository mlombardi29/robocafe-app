/** PIN rules shared by the edge functions and the unit tests. */

export const PIN_MAX_FAILS = 5;
export const PIN_LOCK_MS = 15 * 60 * 1000;
export const IP_MAX_FAILS = 20;
export const IP_WINDOW_MS = 15 * 60 * 1000;

export type LockState = {
  failedCount: number;
  lockedUntil: number | null;
};

export function normalizeLock(state: LockState, now: number): LockState {
  if (state.lockedUntil != null && state.lockedUntil <= now) {
    return { failedCount: 0, lockedUntil: null };
  }
  return { failedCount: state.failedCount, lockedUntil: state.lockedUntil };
}

export function minutesLeft(lockedUntil: number, now: number): number {
  if (lockedUntil <= now) return 0;
  return Math.ceil((lockedUntil - now) / 60_000);
}

/** Count this failure. The 5th failure starts a 15-minute lock. */
export function registerFailure(state: LockState, now: number): LockState {
  const clean = normalizeLock(state, now);
  const failedCount = clean.failedCount + 1;
  if (failedCount >= PIN_MAX_FAILS) {
    return { failedCount, lockedUntil: now + PIN_LOCK_MS };
  }
  return { failedCount, lockedUntil: null };
}

export function pinError(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return "Use 4 to 6 digits.";
  if (/^(\d)\1+$/.test(pin)) return "Do not use the same digit repeated.";
  if (pin === "1234" || pin === "12345" || pin === "123456" || pin === "0000") {
    return "That PIN is too easy to guess.";
  }
  return null;
}

export function ipBlocked(failCountInWindow: number): boolean {
  return failCountInWindow >= IP_MAX_FAILS;
}
