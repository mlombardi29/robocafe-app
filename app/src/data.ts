import { supabase } from "./lib/supabase";
import type { CompletionWrite } from "./lib/queue";
import { completionsForOpenVisit, keptVisitTimes, mergeCompletions, mergedMilkTimes, unsyncedCompletions } from "./lib/queue";
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
  pausedAt?: string | null;
};

const SITE_SELECT_BASE =
  "id, name, short_name, model_id, serial, cadence, opening_time, active, is_sandbox, models(code, name, milk_clean_minutes)";
const SITE_SELECT_FULL =
  "id, name, short_name, model_id, serial, cadence, opening_time, closing_time, soft_prefer_before, soft_prefer_after, active, is_sandbox, models(code, name, milk_clean_minutes)";

function missingSiteHoursColumn(error: { message?: string; code?: string } | null): boolean {
  const message = error?.message ?? "";
  return /closing_time|soft_prefer_before|soft_prefer_after|schema cache|does not exist/i.test(message);
}

function asSiteRows(rows: unknown[]): SiteRow[] {
  return rows.map((row) => {
    const typed = row as SiteRow & { models: SiteRow["models"] | SiteRow["models"][] };
    return { ...typed, models: one(typed.models) };
  });
}

export async function loadSites(): Promise<SiteRow[]> {
  const full = await supabase.from("sites").select(SITE_SELECT_FULL).order("name");
  if (!full.error) return asSiteRows(full.data ?? []);
  if (!missingSiteHoursColumn(full.error)) throw new Error(full.error.message);
  const base = await supabase.from("sites").select(SITE_SELECT_BASE).order("name");
  if (base.error) throw new Error(base.error.message);
  return asSiteRows(base.data ?? []);
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
  let siteQuery = await supabase.from("sites").select(SITE_SELECT_FULL).eq("id", siteId).maybeSingle();
  if (siteQuery.error && missingSiteHoursColumn(siteQuery.error)) {
    siteQuery = await supabase.from("sites").select(SITE_SELECT_BASE).eq("id", siteId).maybeSingle();
  }
  const { data: site, error } = siteQuery;
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
  const serverSessionId = session?.id ?? null;
  const localWrites = completionsForOpenVisit(local, serverSessionId);
  const milk = mergedMilkTimes(
    {
      sessionId: serverSessionId,
      startedAt: session?.milk_clean_started_at ?? null,
      doneAt: session?.milk_clean_done_at ?? null,
    },
    local
      ? { sessionId: local.sessionId, startedAt: local.milkStartedAt, doneAt: local.milkDoneAt }
      : null,
  );
  const sameVisit = Boolean(local?.sessionId && serverSessionId && local.sessionId === serverSessionId);
  const localDraft = sameVisit || !serverSessionId ? local : null;
  const times = keptVisitTimes(
    { startedAt: milk.startedAt, doneAt: milk.doneAt, pausedAt: null },
    { pausedAt: session?.end_at ?? localDraft?.pausedAt ?? null },
  );
  return {
    site: normalized,
    session,
    localSessionId: session?.id ?? localDraft?.sessionId ?? null,
    snapshot,
    settings: settings ?? [],
    state: state ?? [],
    completions: mergeCompletions(serverWrites, localWrites),
    serverCompletions: serverWrites,
    pendingWrites: unsyncedCompletions(serverWrites, localWrites),
    milkStartedAt: times.startedAt,
    milkDoneAt: times.doneAt,
    pausedAt: times.pausedAt,
  };
}
