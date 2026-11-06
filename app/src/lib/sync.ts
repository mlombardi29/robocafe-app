import { del, get, set } from "idb-keyval";
import {
  assessFreshStart,
  freshStartErrorMessage,
  queuedVisitId,
  withoutRetiredVisit,
} from "./freshPractice";
import type { CompletionWrite } from "./queue";
import { outcomeFromEndUpdate, queueAfterFailure, retriesSyncError } from "./serviceFlow";
import { supabase } from "./supabase";

export type FlushResult = {
  ok: boolean;
  error: string | null;
  retry: boolean;
  failedKind: SyncJob["kind"] | null;
};

export type SyncJob =
  | { kind: "completion"; write: CompletionWrite; stepKey: string }
  | { kind: "start"; id: string; siteId: string; start: string; estimated: boolean }
  | { kind: "end"; id: string; end: string }
  | { kind: "milk"; id: string; action: "start" | "done"; reason: string | null }
  | { kind: "complete"; id: string; end: string | null; estimate: string | null };

const QUEUE = "kioskops-queue";

export async function readQueue(): Promise<SyncJob[]> {
  return (await get<SyncJob[]>(QUEUE)) ?? [];
}

export function enqueue(job: SyncJob): Promise<void> {
  return exclusive(() => appendJob(job));
}

export async function rememberVisit(siteId: string, value: unknown): Promise<void> {
  await set(`kioskops-visit:${siteId}`, value);
}

export async function recallVisit<T>(siteId: string): Promise<T | undefined> {
  return get<T>(`kioskops-visit:${siteId}`);
}

export async function forgetVisit(siteId: string): Promise<void> {
  await del(`kioskops-visit:${siteId}`);
}

export async function stableKey(sessionId: string, itemId: string): Promise<string> {
  const storeKey = `kioskops-idem:${sessionId}:${itemId}`;
  const existing = await get<string>(storeKey);
  if (existing) return existing;
  const created = crypto.randomUUID();
  await set(storeKey, created);
  return created;
}

const emptyFlush: FlushResult = { ok: true, error: null, retry: false, failedKind: null };
let chain: Promise<void> = Promise.resolve();

/** One queue read-modify-write at a time, so two taps cannot erase each other. */
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function appendJob(job: SyncJob): Promise<void> {
  const queue = await readQueue();
  queue.push(job);
  await set(QUEUE, queue);
}

export type FreshStartResult = {
  ok: boolean;
  message: string;
  sessionId: string | null;
};

/** Sync first. On success, set the old practice visit aside and drop only its queued saves. */
export function startFreshPractice(retiredId: string, newId: string, start: string): Promise<FreshStartResult> {
  return exclusive(() => runFreshPractice(retiredId, newId, start));
}

async function runFreshPractice(retiredId: string, newId: string, start: string): Promise<FreshStartResult> {
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  if (!online) {
    return { ok: false, message: assessFreshStart(false, false, 0).message, sessionId: null };
  }
  const first = await runFlush();
  let retiredLeft = (await readQueue()).filter((job) => queuedVisitId(job) === retiredId).length;
  if (first.ok && retiredLeft > 0) {
    const second = await runFlush();
    retiredLeft = (await readQueue()).filter((job) => queuedVisitId(job) === retiredId).length;
    const gate = assessFreshStart(true, second.ok, retiredLeft);
    if (!gate.proceed) return { ok: false, message: gate.message, sessionId: null };
  } else {
    const gate = assessFreshStart(true, first.ok, retiredLeft);
    if (!gate.proceed) return { ok: false, message: gate.message, sessionId: null };
  }

  const { data, error } = await supabase.rpc("start_fresh_practice", {
    p_session: retiredId,
    p_new_id: newId,
    p_start: start,
  });
  if (error) {
    return { ok: false, message: freshStartErrorMessage(error.message, error.code), sessionId: null };
  }
  const sessionId = data && typeof data === "object" && "id" in data && typeof data.id === "string" ? data.id : newId;
  const queued = await readQueue();
  await set(QUEUE, withoutRetiredVisit(queued, retiredId));
  return { ok: true, message: "", sessionId };
}

export function flushQueue(): Promise<FlushResult> {
  return exclusive(() => runFlush());
}

/** Queue one save and flush after it, so the result belongs to this save. */
export function enqueueAndFlush(job: SyncJob): Promise<FlushResult> {
  return exclusive(async () => {
    await appendJob(job);
    return runFlush();
  });
}

async function runFlush(): Promise<FlushResult> {
  const queue = await readQueue();
  for (let index = 0; index < queue.length; index += 1) {
    const job = queue[index];
    if (!job) continue;
    try {
      await runJob(job);
    } catch (err) {
      const retry = !(err instanceof SyncRejected);
      const message = err instanceof Error ? err.message : "Could not sync.";
      await set(QUEUE, queueAfterFailure(queue, index, retry));
      return { ok: false, error: message, retry, failedKind: job.kind };
    }
  }
  await set(QUEUE, []);
  return emptyFlush;
}

class SyncRejected extends Error {}

async function runJob(job: SyncJob): Promise<void> {
  if (job.kind === "start") {
    const { error } = await supabase.rpc("start_session", {
      p_id: job.id,
      p_site: job.siteId,
      p_start: job.start,
      p_estimated: job.estimated,
    });
    if (error) throw new Error(error.message);
    return;
  }
  if (job.kind === "completion") {
    const { error } = await supabase.rpc("save_completion", {
      p_session: job.write.sessionId,
      p_item: job.write.itemId,
      p_state: job.write.state,
      p_value: job.write.value,
      p_note: job.write.note,
      p_override_reason: job.write.overrideReason,
      p_rev: job.write.clientRev,
      p_key: job.write.idempotencyKey,
      p_step: job.stepKey,
    });
    if (error) throw new Error(error.message);
    return;
  }
  if (job.kind === "end") {
    const { data, error } = await supabase
      .from("service_sessions")
      .update({ end_at: job.end })
      .eq("id", job.id)
      .select("id");
    const outcome = outcomeFromEndUpdate(data ?? null, error?.message ?? null);
    if (!outcome.ok) {
      if (outcome.retry) throw new Error(outcome.message);
      throw new SyncRejected(outcome.message);
    }
    return;
  }
  if (job.kind === "milk") {
    const { error } = await supabase.rpc("set_milk_clean", {
      p_id: job.id,
      p_action: job.action,
      p_override_reason: job.reason,
    });
    if (error) {
      if (!retriesSyncError(error.code, error.message)) throw new SyncRejected(error.message);
      throw new Error(error.message);
    }
    return;
  }
  const { error } = await supabase.rpc("complete_session", {
    p_id: job.id,
    p_end: job.end,
    p_start_estimate: job.estimate,
  });
  if (error) throw new Error(error.message);
}

export function watchSync(): () => void {
  const kick = () => {
    void flushQueue();
  };
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", kick);
  const timer = window.setInterval(kick, 5000);
  kick();
  return () => {
    window.removeEventListener("online", kick);
    document.removeEventListener("visibilitychange", kick);
    window.clearInterval(timer);
  };
}
