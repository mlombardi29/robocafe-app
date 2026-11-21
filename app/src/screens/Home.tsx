import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { loadRecentSessions, loadShowDays, loadSites, type LocalVisit } from "../data";
import { recallVisit } from "../lib/sync";
import { formatTorontoTime, torontoNow } from "../lib/dates";
import { addDays, parseClock, previousMwf, visitStatus } from "../lib/due";
import { inPractice } from "../lib/access";
import { type CoverageRow } from "../lib/coverage";
import { opsBoardCounts, sumOnHand } from "../lib/opsDashboard";
import { turnedOff } from "../lib/rpcError";
import {
  formatPlanDay,
  nextServiceShifts,
  outstandingVisits,
  type PlanSite,
  type ShowDay,
  type TodaySiteState,
} from "../lib/homePlan";
import { BUY_MILK_HINT, MILK_2PCT_LEGACY_ID, buyMilkOnTheWay } from "../lib/stockRules";
import { supabase } from "../lib/supabase";
import { ErrorText, Screen, Title } from "../ui";

export function HomePage() {
  const { profile } = useAuth();
  const clock = torontoNow();
  const practice = profile ? inPractice(profile.role, profile.mode) : false;
  const sites = useQuery({ queryKey: ["sites", profile?.id, profile?.mode], enabled: Boolean(profile), queryFn: loadSites });
  const showsQuery = useQuery({
    queryKey: ["shows", clock.today],
    enabled: Boolean(profile),
    queryFn: () => loadShowDays(clock.today),
  });
  const sessions = useQuery({
    queryKey: ["recent", clock.today],
    enabled: Boolean(profile),
    queryFn: () => loadRecentSessions(addDays(clock.today, -14)),
  });
  const board = useQuery({
    queryKey: ["ops-board", practice, clock.today],
    enabled: Boolean(profile) && profile?.role !== "visitor",
    queryFn: async () => {
      const milkLegacy = practice ? `${MILK_2PCT_LEGACY_ID}:practice` : MILK_2PCT_LEGACY_ID;
      const [flags, levels, txs, coverage, milkSku] = await Promise.all([
        supabase.from("stock_flags").select("status, site_id, sku_id, resolved_at, is_sandbox").eq("is_sandbox", practice).is("resolved_at", null),
        supabase.from("site_skus").select("site_id, sku_id, low_threshold, is_sandbox").eq("is_sandbox", practice),
        supabase.from("inventory_tx").select("sku_id, site_id, location, delta_base, is_sandbox"),
        supabase
          .from("schedule_overrides")
          .select("id, site_id, service_date, coverage_requested, requested_by, claimed_by, note, is_sandbox")
          .eq("is_sandbox", practice),
        supabase.from("skus").select("id, legacy_id").eq("legacy_id", milkLegacy).maybeSingle(),
      ]);
      return {
        flags: flags.error
          ? null
          : ((flags.data ?? []) as { status: "low" | "out"; site_id: string; sku_id: string | null; resolved_at: string | null }[]),
        levels: levels.error ? null : ((levels.data ?? []) as { site_id: string; sku_id: string; low_threshold: number | null }[]),
        txs: txs.error ? null : ((txs.data ?? []) as { sku_id: string; site_id: string | null; location: string; delta_base: number; is_sandbox: boolean }[]),
        coverage: coverage.error
          ? null
          : ((coverage.data ?? []) as (CoverageRow & { is_sandbox: boolean })[]),
        milkSkuId: milkSku.error || !milkSku.data ? null : (milkSku.data.id as string),
        coverageMissing: turnedOff(coverage.error as { message?: string } | null, "schedule_overrides"),
        flagsMissing: turnedOff(flags.error as { message?: string } | null, "stock_flags"),
      };
    },
  });

  const visible = (sites.data ?? []).filter((site) => site.is_sandbox === practice);
  const siteIds = visible.map((site) => site.id);
  const onHandRows = board.data?.txs ? sumOnHand(board.data.txs, practice) : [];
  const counts =
    board.data?.flags && board.data.levels && board.data.txs
      ? opsBoardCounts({
          flags: board.data.flags,
          levels: board.data.levels,
          onHand: onHandRows,
          coverage: board.data.coverage ?? [],
          today: clock.today,
          siteIds,
        })
      : null;
  const drafts = useQuery({
    queryKey: ["drafts", profile?.id, visible.map((site) => site.id).join(",")],
    enabled: visible.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(visible.map(async (site) => [site.id, await recallVisit<LocalVisit>(site.id)] as const));
      return Object.fromEntries(entries);
    },
  });
  const error = sites.error instanceof Error ? sites.error.message : "";
  const planSites: PlanSite[] = visible.map((site) => ({
    id: site.id,
    shortName: site.short_name,
    name: site.name,
    cadence: site.cadence,
    active: site.active,
  }));
  const shows: ShowDay[] = (showsQuery.data ?? []).map((row) => ({
    siteId: row.site_id,
    date: row.date,
    status: row.status ?? null,
  }));
  const todayStates: TodaySiteState[] = [];
  const extras = new Map<string, { hint: string | null; hintActive: boolean; milk: boolean }>();

  for (const site of visible) {
    const siteSessions = (sessions.data ?? []).filter((row) => row.site_id === site.id);
    const completed = siteSessions.filter((row) => row.status === "completed").map((row) => row.service_date);
    const completedToday = siteSessions
      .filter((row) => row.status === "completed" && row.service_date === clock.today)
      .sort((a, b) => String(b.end_at ?? b.submitted_at ?? "").localeCompare(String(a.end_at ?? a.submitted_at ?? "")));
    const completedTodayTime = formatTorontoTime(completedToday[0]?.end_at ?? completedToday[0]?.submitted_at ?? null);
    const openVisit = siteSessions.find((row) => row.status === "open");
    const draft = drafts.data?.[site.id];
    const draftMatches = Boolean(draft?.sessionId && (!openVisit || openVisit.id === draft.sessionId));
    const pausedSource = openVisit?.end_at ?? (draftMatches ? draft?.pausedAt : null);
    const pausedTime = pausedSource ? formatTorontoTime(pausedSource) : null;
    const inProgress = Boolean((openVisit && !openVisit.end_at) || (draftMatches && draft?.sessionId && !pausedSource));
    const incompleteToday = !openVisit && completedToday.length === 0 && siteSessions.some((row) => row.status === "voided" && row.service_date === clock.today);
    const show = (showsQuery.data ?? []).find((row) => row.site_id === site.id && row.date === clock.today);
    const previous = site.cadence === "daily" ? addDays(clock.today, -1) : site.cadence === "mwf" ? previousMwf(clock.today) : null;
    const status = visitStatus({
      cadence: site.cadence,
      openingTime: site.opening_time,
      softPreferBefore: site.soft_prefer_before,
      softPreferAfter: site.soft_prefer_after,
      active: site.active,
      weekday: clock.weekday,
      nowMinutes: clock.nowMinutes,
      showStartMinutes: parseClock(show?.show_start_time ?? null),
      showStatus: show?.status ?? null,
      startedToday: siteSessions.some((row) => row.service_date === clock.today && row.start_at),
      completedDates: completed,
      previousServiceDate: previous,
      completedTodayTime: openVisit ? null : completedTodayTime || null,
      pausedTime: pausedTime || null,
      visitInProgress: inProgress,
      incompleteToday,
    });
    const milkSkuId = board.data?.milkSkuId ?? null;
    const milkOnHand = milkSkuId ? (onHandRows.find((row) => row.site_id === site.id && row.sku_id === milkSkuId)?.onHand ?? null) : null;
    const needMilk = buyMilkOnTheWay({
      siteId: site.id,
      milkSkuId,
      openFlags: board.data?.flags ?? [],
      siteOnHandLitres: milkOnHand,
    });
    todayStates.push({
      siteId: site.id,
      due: status.due,
      completed: Boolean(completedTodayTime) && !openVisit,
      inProgress,
      paused: Boolean(pausedTime),
      label: status.label,
    });
    extras.set(site.id, {
      hint: status.softHint ? `${status.softHint}${status.softHintActive ? " · lunch is busy" : ""}` : null,
      hintActive: status.softHintActive,
      milk: needMilk,
    });
  }

  const outstanding = outstandingVisits(planSites, todayStates);
  const doneToday = todayStates.filter((row) => row.completed);
  const nextShifts = nextServiceShifts(planSites, clock.today, shows);
  const stockFlags = counts?.serviceFlags ?? 0;
  const coverageOpen = board.data?.coverageMissing ? 0 : (counts?.coverageNeeded ?? 0);

  return (
    <TodayView
      dateLabel={formatPlanDay(clock.today)}
      loading={sites.isLoading}
      empty={!sites.isLoading && visible.length === 0}
      error={error}
      outstanding={outstanding}
      extras={extras}
      doneToday={doneToday.map((row) => planSites.find((site) => site.id === row.siteId)?.shortName ?? "Visit")}
      stockFlags={profile && profile.role !== "visitor" ? stockFlags : 0}
      coverageOpen={profile && profile.role !== "visitor" ? coverageOpen : 0}
      nextShifts={nextShifts}
      showNext={outstanding.length > 0}
    />
  );
}

export function TodayView({
  dateLabel,
  loading,
  empty,
  error,
  outstanding,
  extras,
  doneToday,
  stockFlags,
  coverageOpen,
  nextShifts,
  showNext,
}: {
  dateLabel: string;
  loading?: boolean;
  empty?: boolean;
  error?: string;
  outstanding: { siteId: string; shortName: string; name: string; action: string; detail: string }[];
  extras?: Map<string, { hint: string | null; hintActive: boolean; milk: boolean }>;
  doneToday: string[];
  stockFlags: number;
  coverageOpen: number;
  nextShifts: { date: string; siteId: string; shortName: string }[];
  showNext: boolean;
}) {
  return (
    <Screen>
      <Title sub={dateLabel}>Today</Title>
      {loading ? <p className="text-stone-600">Loading sites…</p> : null}
      {empty ? <p className="text-stone-600">No sites for this mode yet.</p> : null}
      {outstanding.length > 0 ? (
        <div className="grid gap-3">
          {outstanding.map((visit) => {
            const extra = extras?.get(visit.siteId);
            return (
              <Link key={visit.siteId} to={`/service/${visit.siteId}`} className="block rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <p className="text-sm font-semibold uppercase tracking-wide text-[var(--accent)]">{visit.action}</p>
                <h2 className="mt-1 text-3xl font-semibold tracking-tight">{visit.shortName}</h2>
                <p className="text-base text-stone-600">{visit.name}</p>
                <p className={`mt-2 text-base font-semibold ${/late|missed|before opening/i.test(visit.detail) ? "text-red-700" : "text-stone-800"}`}>
                  {visit.detail}
                </p>
                {extra?.hint ? (
                  <p className={`mt-1 text-sm ${extra.hintActive ? "font-medium text-amber-800" : "text-stone-500"}`}>{extra.hint}</p>
                ) : null}
                {extra?.milk ? <p className="mt-1 text-sm font-medium text-amber-900">{BUY_MILK_HINT}</p> : null}
                <span className="mt-4 flex min-h-14 items-center justify-center rounded-2xl bg-[var(--accent)] px-4 text-lg font-semibold text-white">
                  {visit.action}
                </span>
              </Link>
            );
          })}
        </div>
      ) : !loading && !empty ? (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <h2 className="text-2xl font-semibold tracking-tight">{doneToday.length > 0 ? "You're done for today" : "Nothing scheduled today"}</h2>
          {nextShifts.length > 0 ? (
            <>
              <p className="mt-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Next shift</p>
              <ul className="mt-2 grid gap-2">
                {nextShifts.map((shift) => (
                  <li key={shift.siteId} className="text-lg font-semibold">
                    {shift.shortName}
                    <span className="mt-0.5 block text-base font-medium text-stone-600">{formatPlanDay(shift.date)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-base text-stone-600">No upcoming service day in the next three weeks.</p>
          )}
          <Link to="/schedule" className="mt-4 flex min-h-14 items-center justify-center rounded-2xl bg-[var(--accent)] px-4 text-lg font-semibold text-white">
            See schedule
          </Link>
        </section>
      ) : null}
      {doneToday.length > 0 ? (
        <p className="mt-4 text-sm font-medium text-stone-600">Done today · {doneToday.join(", ")}</p>
      ) : null}
      {stockFlags > 0 || coverageOpen > 0 || (showNext && nextShifts.length > 0) ? (
        <div className="mt-4 grid gap-2">
          {stockFlags > 0 ? (
            <Link to="/inventory" className="flex min-h-14 items-center justify-between rounded-2xl bg-white px-4 font-semibold shadow-sm ring-1 ring-black/5">
              <span>Stock</span>
              <span className="text-sm font-semibold text-amber-800">{stockFlags} flag{stockFlags === 1 ? "" : "s"}</span>
            </Link>
          ) : null}
          {coverageOpen > 0 ? (
            <Link to="/schedule" className="flex min-h-14 items-center justify-between rounded-2xl bg-white px-4 font-semibold shadow-sm ring-1 ring-black/5">
              <span>Coverage</span>
              <span className="text-sm font-semibold text-amber-800">{coverageOpen} open</span>
            </Link>
          ) : null}
          {showNext && nextShifts.length > 0 ? (
            <Link to="/schedule" className="flex min-h-14 items-center justify-between rounded-2xl bg-white px-4 font-semibold shadow-sm ring-1 ring-black/5">
              <span>Next shift</span>
              <span className="text-sm font-semibold text-stone-600">
                {nextShifts.map((shift) => shift.shortName).join(", ")} · {formatPlanDay(nextShifts[0]!.date)}
              </span>
            </Link>
          ) : null}
        </div>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
