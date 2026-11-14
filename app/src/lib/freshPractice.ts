/** Rules for starting a fresh practice visit. No network. */

export const FRESH_OFFLINE =
  "You're offline. This practice visit stays as it is, including anything still on this phone.";

export const FRESH_UNSYNCED =
  "This phone still has unsynced work. Fresh start was not done, and nothing was discarded.";

export const FRESH_NOT_READY =
  "Fresh practice visits are not turned on yet. This visit was not changed.";

export type QueuedVisit =
  | { kind: "completion"; write: { sessionId: string } }
  | { kind: "start" | "end" | "milk" | "complete"; id: string };

export function queuedVisitId(job: QueuedVisit): string {
  return job.kind === "completion" ? job.write.sessionId : job.id;
}

/** Drop queued saves for one retired visit. Every other visit stays. */
export function withoutRetiredVisit<T extends QueuedVisit>(queue: T[], retiredId: string): T[] {
  return queue.filter((job) => queuedVisitId(job) !== retiredId);
}

/**
 * Sync must succeed before the old visit is set aside.
 * A timer on its own is not a reason to write Done.
 */
export function assessFreshStart(
  online: boolean,
  flushOk: boolean,
  retiredJobsLeft: number,
): { proceed: boolean; message: string } {
  if (!online) return { proceed: false, message: FRESH_OFFLINE };
  if (!flushOk || retiredJobsLeft > 0) return { proceed: false, message: FRESH_UNSYNCED };
  return { proceed: true, message: "" };
}

export function completionToWriteForExistingTimer(): null {
  return null;
}

export function freshStartErrorMessage(message: string, code?: string | null): string {
  const missing =
    code === "PGRST202" ||
    /schema cache/i.test(message) ||
    (/start_fresh_practice/i.test(message) && /does not exist|could not find/i.test(message));
  if (missing) return FRESH_NOT_READY;
  if (!message.trim()) return "Could not start a fresh practice visit. This visit was not changed.";
  return message;
}

export function offerFreshStart(practice: boolean, sandboxSite: boolean, openVisit: boolean): boolean {
  return practice && sandboxSite && openVisit;
}
