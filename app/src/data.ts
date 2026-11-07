import { supabase } from "./lib/supabase";
import type { CompletionWrite } from "./lib/queue";
import { completionsForOpenVisit, mergeCompletions, mergedMilkTimes, unsyncedCompletions } from "./lib/queue";
import { recallVisit } from "./lib/sync";
import type { SessionRow, SiteRow, Snapshot, SnapItem, SnapSection } from "./lib/types";

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export type LocalVisit = {
  sessionId: string | null;
  completions: CompletionWrite[];
  milkStartedAt: string | null;
  milkDoneAt: string | null;
};

export async function loadSites(): Promise<SiteRow[]> {
  const { data, error } = await supabase
    .from("sites")
    .select("id, name, short_name, model_id, serial, cadence, opening_time, active, is_sandbox, models(code, name, milk_clean_minutes)")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ ...row, models: one(row.models) })) as SiteRow[];
}

export async function loadShowDays(from: string) {
  const { data, error } = await supabase
    .from("show_days")
    .select("id, site_id, date, show_start_time, status")
    .gte("date", from);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadRecentSessions(from: string) {
  const { data, error } = await supabase
    .from("service_sessions")
    .select("id, site_id, person_id, service_date, status, start_at, end_at, start_estimated, submitted_at")
    .gte("service_date", from);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function publishedSnapshot(modelId: string): Promise<Snapshot | null> {
  const { data: template, error } = await supabase
    .from("checklist_templates")
    .select("id, version, models(code, milk_clean_minutes)")
    .eq("model_id", modelId)
    .eq("published", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!template) return null;
  const model = one(template.models);
  const { data: sections, error: sectionError } = await supabase
    .from("checklist_sections")
    .select("id, title, phase, position, checklist_items(*)")
    .eq("template_id", template.id)
    .order("position");
  if (sectionError) throw new Error(sectionError.message);
  const mapped: SnapSection[] = (sections ?? []).map((section) => ({
    id: section.id,
    title: section.title,
    phase: section.phase,
    position: section.position,
    items: ((section.checklist_items ?? []) as SnapItem[]).slice().sort((a, b) => a.position - b.position),
  }));
  return {
    version: template.version,
    template_id: template.id,
    model_code: model?.code ?? "",
    milk_clean_minutes: model?.milk_clean_minutes ?? 0,
    sections: mapped,
  };
}

export async function loadService(siteId: string, personId: string) {
  const { data: site, error } = await supabase
    .from("sites")
    .select("id, name, short_name, model_id, serial, cadence, opening_time, active, is_sandbox, models(code, name, milk_clean_minutes)")
    .eq("id", siteId)
    .maybeSingle();
  if (error || !site) throw new Error(error?.message ?? "That site is not available.");
  const normalized = { ...site, models: one(site.models) } as SiteRow;

  const { data: open, error: openError } = await supabase
    .from("service_sessions")
    .select("*")
    .eq("site_id", siteId)
    .eq("person_id", personId)
    .eq("status", "open")
    .maybeSingle();
  if (openError) throw new Error(openError.message);

  const session = (open as SessionRow | null) ?? null;
  const snapshot = session?.checklist_snapshot ?? (await publishedSnapshot(normalized.model_id));
  const [{ data: settings, error: settingsError }, { data: state, error: stateError }] = await Promise.all([
    supabase.from("site_item_settings").select("item_id, threshold_value, threshold_unit").eq("site_id", siteId),
    supabase.from("site_item_state").select("item_id, last_done_at").eq("site_id", siteId),
  ]);
  if (settingsError) throw new Error(settingsError.message);
  if (stateError) throw new Error(stateError.message);

  let serverWrites: CompletionWrite[] = [];
  if (session) {
    const { data: rows, error: completionError } = await supabase
      .from("service_item_completions")
      .select("session_id, item_id, state, note, override_reason, value, client_rev, idempotency_key")
      .eq("session_id", session.id);
    if (completionError) throw new Error(completionError.message);
    serverWrites = (rows ?? []).map((row) => ({
      sessionId: row.session_id,
      itemId: row.item_id,
      idempotencyKey: row.idempotency_key ?? row.item_id,
      clientRev: row.client_rev ?? 0,
      state: row.state,
      note: row.note ?? "",
      overrideReason: row.override_reason ?? "",
      value: row.value ?? "",
    }));
  }
  const local = await recallVisit<LocalVisit>(siteId);
  const localWrites = completionsForOpenVisit(local, session?.id ?? null);
  const milk = mergedMilkTimes(
    {
      sessionId: session?.id ?? null,
      startedAt: session?.milk_clean_started_at ?? null,
      doneAt: session?.milk_clean_done_at ?? null,
    },
    local
      ? { sessionId: local.sessionId, startedAt: local.milkStartedAt, doneAt: local.milkDoneAt }
      : null,
  );
  return {
    site: normalized,
    session,
    snapshot,
    settings: settings ?? [],
    state: state ?? [],
    completions: mergeCompletions(serverWrites, localWrites),
    serverCompletions: serverWrites,
    pendingWrites: unsyncedCompletions(serverWrites, localWrites),
    milkStartedAt: milk.startedAt,
    milkDoneAt: milk.doneAt,
  };
}
