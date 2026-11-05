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
