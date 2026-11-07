/** Pure rules for End now and Complete service. No network. */

export type StepState = "done" | "not_needed" | "na" | "override" | string;

export type RequiredStep = {
  id: string;
  key: string;
  title: string;
  required: boolean;
};

export function stepSatisfied(step: { key: string }, state: StepState | undefined, milkStartedAt: string | null): boolean {
  if (state === "done" || state === "not_needed") return true;
  // A timer that already started counts, including visits opened before this fix.
  if (step.key === "start_milk_clean" && milkStartedAt) return true;
  return false;
}

export function unfinishedRequired(
  steps: RequiredStep[],
  states: Record<string, StepState | undefined>,
  milkStartedAt: string | null,
): RequiredStep[] {
  return steps.filter((step) => step.required && !stepSatisfied(step, states[step.id], milkStartedAt));
}

export type EndUpdateOutcome = {
  ok: boolean;
  retry: boolean;
  message: string;
};

export function outcomeFromEndUpdate(
  rows: { id: string }[] | null,
  errorMessage: string | null,
): EndUpdateOutcome {
  if (errorMessage) {
    return { ok: false, retry: true, message: errorMessage };
  }
  if (!rows || rows.length === 0) {
    return {
      ok: false,
      retry: false,
      message: "End time was not saved. This visit may already be submitted, or Practice mode does not match the visit.",
    };
  }
  return { ok: true, retry: false, message: "" };
}

export const COMPLETE_QUEUED =
  "Saved on this phone. It will sync when you are online. This visit is still open.";

export const CLOCK_OUT_SAVED = "This visit is still open.";

/** A server rejection must not sit at the front of the queue. A dropped connection should. */
export function retriesSyncError(code: string | null | undefined, message: string): boolean {
  if (code && (/^P\d{4}$/.test(code) || /^23\d{3}$/.test(code))) return false;
  if (/finish the prep steps first/i.test(message)) return false;
  return true;
}

export function completeFollowUp(result: { ok: boolean; retry: boolean }): "home" | "stay" {
  return result.ok ? "home" : "stay";
}

/** Retryable failures stay queued. A zero-row end update is dropped so it is not retried forever. */
export function queueAfterFailure<T>(queue: T[], failedIndex: number, retry: boolean): T[] {
  if (failedIndex < 0) return queue;
  if (retry) return queue.slice(failedIndex);
  return queue.slice(failedIndex + 1);
}

export type EndNotice =
  | { kind: "saved"; iso: string }
  | { kind: "queued"; iso: string; detail: string }
  | { kind: "error"; iso: string; detail: string };

/** Pause confirmation. Long enough to read, short enough that it cannot sit on the next tap. */
export const SUCCESS_TOAST_MS = 1000;

export function successToast(notice: EndNotice | null): boolean {
  return notice?.kind === "saved" || notice?.kind === "queued";
}

/** A confirmation dialog hides a pause/success toast. Errors stay for after the dialog closes. */
export function visibleEndNotice(notice: EndNotice | null, modalOpen: boolean): EndNotice | null {
  if (!notice) return null;
  if (modalOpen && successToast(notice)) return null;
  return notice;
}

export function endNotice(iso: string, outcome: EndUpdateOutcome, failedKind: string | null): EndNotice {
  if (outcome.ok && (failedKind === null || failedKind === "end")) {
    return { kind: "saved", iso };
  }
  if (outcome.retry) {
    return {
      kind: "queued",
      iso,
      detail: outcome.message || "It will sync when you are online.",
    };
  }
  return { kind: "error", iso, detail: outcome.message || "End time was not saved." };
}
