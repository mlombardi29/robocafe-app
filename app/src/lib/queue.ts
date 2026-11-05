export type CompletionState = "done" | "not_needed" | "na" | "override";

export type CompletionWrite = {
  sessionId: string;
  itemId: string;
  idempotencyKey: string;
  clientRev: number;
  state: CompletionState;
  note: string;
  overrideReason: string;
  value: string;
};

export type StartWrite = { id: string; siteId: string; start: string };

/** Same session id any number of times is still one visit. */
export function reduceStarts(starts: StartWrite[]): StartWrite[] {
  const map = new Map<string, StartWrite>();
  for (const start of starts) map.set(start.id, start);
  return [...map.values()];
}

/**
 * One row per visit step. A replay keeps the first idempotency key.
 * A newer client_rev replaces the fields. An older replay is ignored.
 */
export function reduceCompletions(writes: CompletionWrite[]): CompletionWrite[] {
  const map = new Map<string, CompletionWrite>();
  for (const write of writes) {
    const key = `${write.sessionId}:${write.itemId}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, write);
      continue;
    }
    if (write.clientRev >= prev.clientRev) {
      map.set(key, { ...write, idempotencyKey: prev.idempotencyKey });
    }
  }
  return [...map.values()];
}

export function mergeCompletions(server: CompletionWrite[], local: CompletionWrite[]): CompletionWrite[] {
  return reduceCompletions([...server, ...local]);
}

/**
 * Taps belong to one visit. A new visit must not inherit another visit's saved taps.
 * With no server visit yet, keep only the on-phone draft for its own session id.
 */
export function completionsForOpenVisit(
  local: { sessionId: string | null; completions: CompletionWrite[] } | null | undefined,
  serverSessionId: string | null,
): CompletionWrite[] {
  if (!local?.sessionId) return [];
  if (serverSessionId && local.sessionId !== serverSessionId) return [];
  return local.completions.filter((row) => row.sessionId === local.sessionId);
}
