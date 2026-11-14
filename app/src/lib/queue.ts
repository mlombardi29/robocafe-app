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

/** Phone taps the server does not have yet. A newer revision is sent again. An older one is not. */
export function unsyncedCompletions(server: CompletionWrite[], local: CompletionWrite[]): CompletionWrite[] {
  const saved = new Map(server.map((row) => [`${row.sessionId}:${row.itemId}`, row]));
  return local.filter((row) => {
    const previous = saved.get(`${row.sessionId}:${row.itemId}`);
    if (!previous) return true;
    return row.clientRev > previous.clientRev;
  });
}

/** Skip a tap that is already waiting in the sync queue at the same revision. */
export function completionsNotQueued(pending: CompletionWrite[], queuedItemRevs: string[]): CompletionWrite[] {
  const waiting = new Set(queuedItemRevs);
  return pending.filter((row) => !waiting.has(`${row.sessionId}:${row.itemId}:${row.clientRev}`));
}

/**
 * Local milk times show after a reload only for this visit, and only when the server has none.
 * A server time always wins. A different visit's local timer is ignored.
 */
/** A later save that does not mention the timer must not erase it. */
export function keptVisitTimes<T extends { startedAt: string | null; doneAt: string | null; pausedAt: string | null }>(
  current: T,
  patch: { startedAt?: string | null; doneAt?: string | null; pausedAt?: string | null },
): { startedAt: string | null; doneAt: string | null; pausedAt: string | null } {
  return {
    startedAt: patch.startedAt !== undefined ? patch.startedAt : current.startedAt,
    doneAt: patch.doneAt !== undefined ? patch.doneAt : current.doneAt,
    pausedAt: patch.pausedAt !== undefined ? patch.pausedAt : current.pausedAt,
  };
}

export function mergedMilkTimes(
  server: { sessionId: string | null; startedAt: string | null; doneAt: string | null },
  local: { sessionId: string | null; startedAt: string | null; doneAt: string | null } | null,
): { startedAt: string | null; doneAt: string | null } {
  const sameVisit = Boolean(local?.sessionId && server.sessionId && local.sessionId === server.sessionId);
  const localVisit = sameVisit ? local : server.sessionId ? null : local;
  return {
    startedAt: server.startedAt ?? localVisit?.startedAt ?? null,
    doneAt: server.doneAt ?? localVisit?.doneAt ?? null,
  };
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
