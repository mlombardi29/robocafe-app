/** Which checklist buttons stay locked while the milk timer is running. */

export const WIPE_CAMEO_KEY = "wipe_cameo";

export const MILK_LOCK_NOT_NEEDED_OK =
  "Done unlocks when milk cleaning finishes. You can mark Not needed now.";

export const MILK_LOCK_FULL = "Locked while milk cleaning runs.";

export type MilkLock = {
  doneLocked: boolean;
  notNeededLocked: boolean;
  message: string | null;
};

export function milkCleanRunning(
  startedAt: string | null,
  doneAt: string | null,
  minutes: number,
  nowMs: number,
): boolean {
  if (!startedAt || doneAt) return false;
  if (!Number.isFinite(minutes) || minutes <= 0) return false;
  const ends = new Date(startedAt).getTime() + minutes * 60_000;
  return Number.isFinite(ends) && nowMs < ends;
}

/**
 * Wipe the Cameo can be judged by looking, so Not needed stays available.
 * Other locked steps are prep that would interrupt the cleaning, so both buttons stay off.
 */
export function milkStepLocks(
  step: { key: string; lockedDuringClean: boolean },
  running: boolean,
): MilkLock {
  if (!running || !step.lockedDuringClean) {
    return { doneLocked: false, notNeededLocked: false, message: null };
  }
  if (step.key === WIPE_CAMEO_KEY) {
    return { doneLocked: true, notNeededLocked: false, message: MILK_LOCK_NOT_NEEDED_OK };
  }
  return { doneLocked: true, notNeededLocked: true, message: MILK_LOCK_FULL };
}
