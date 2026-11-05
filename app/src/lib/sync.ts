import { get, set } from "idb-keyval";
import type { CompletionWrite } from "./queue";
import { supabase } from "./supabase";

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

export async function enqueue(job: SyncJob): Promise<void> {
  const queue = await readQueue();
  queue.push(job);
  await set(QUEUE, queue);
}

export async function rememberVisit(siteId: string, value: unknown): Promise<void> {
  await set(`kioskops-visit:${siteId}`, value);
}

export async function recallVisit<T>(siteId: string): Promise<T | undefined> {
  return get<T>(`kioskops-visit:${siteId}`);
}

export async function stableKey(sessionId: string, itemId: string): Promise<string> {
  const storeKey = `kioskops-idem:${sessionId}:${itemId}`;
  const existing = await get<string>(storeKey);
  if (existing) return existing;
  const created = crypto.randomUUID();
  await set(storeKey, created);
  return created;
}

let flushing = false;

export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const queue = await readQueue();
    const remaining: SyncJob[] = [];
    for (const job of queue) {
      try {
        await runJob(job);
      } catch {
        remaining.push(job, ...queue.slice(queue.indexOf(job) + 1));
        break;
      }
    }
    await set(QUEUE, remaining);
  } finally {
    flushing = false;
  }
}

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
    const { error } = await supabase.from("service_sessions").update({ end_at: job.end }).eq("id", job.id);
    if (error) throw new Error(error.message);
    return;
  }
  if (job.kind === "milk") {
    const { error } = await supabase.rpc("set_milk_clean", {
      p_id: job.id,
      p_action: job.action,
      p_override_reason: job.reason,
    });
    if (error) throw new Error(error.message);
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
