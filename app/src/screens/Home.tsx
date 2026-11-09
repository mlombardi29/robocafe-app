import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { supabase } from "../lib/supabase";
import { Button, Card, ErrorText, Screen, Title } from "../ui";

export function HomePage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const clock = torontoNow();
  const practice = profile ? inPractice(profile.role, profile.mode) : false;
  const sites = useQuery({ queryKey: ["sites", profile?.id, profile?.mode], enabled: Boolean(profile), queryFn: loadSites });
  const shows = useQuery({
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
      const [flags, levels, txs, coverage] = await Promise.all([
        supabase.from("stock_flags").select("status, site_id, resolved_at, is_sandbox").eq("is_sandbox", practice).is("resolved_at", null),
        supabase.from("site_skus").select("site_id, sku_id, low_threshold, is_sandbox").eq("is_sandbox", practice),
        supabase.from("inventory_tx").select("sku_id, site_id, location, delta_base, is_sandbox"),
        supabase
          .from("schedule_overrides")
          .select("id, site_id, service_date, coverage_requested, requested_by, claimed_by, note, is_sandbox")
          .eq("is_sandbox", practice),
      ]);
      return {
        flags: flags.error ? null : ((flags.data ?? []) as { status: "low" | "out"; site_id: string; resolved_at: string | null }[]),
        levels: levels.error ? null : ((levels.data ?? []) as { site_id: string; sku_id: string; low_threshold: number | null }[]),
        txs: txs.error ? null : ((txs.data ?? []) as { sku_id: string; site_id: string | null; location: string; delta_base: number; is_sandbox: boolean }[]),
        coverage: coverage.error
          ? null
          : ((coverage.data ?? []) as (CoverageRow & { is_sandbox: boolean })[]),
        coverageMissing: turnedOff(coverage.error as { message?: string } | null, "schedule_overrides"),
        flagsMissing: turnedOff(flags.error as { message?: string } | null, "stock_flags"),
      };
    },
  });

  async function toggleMode() {
    if (!profile || profile.role === "trainee") return;
    const next = profile.mode === "practice" ? "live" : "practice";
    const { error } = await supabase.rpc("set_mode", { p_mode: next });
    if (error) return;
    await queryClient.invalidateQueries();
  }

  const visible = (sites.data ?? []).filter((site) => site.is_sandbox === practice);
  const siteIds = visible.map((site) => site.id);
  const counts =
    board.data?.flags && board.data.levels && board.data.txs
      ? opsBoardCounts({
          flags: board.data.flags,
          levels: board.data.levels,
          onHand: sumOnHand(board.data.txs, practice),
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

  return (
    <Screen>
      <Title sub={clock.today}>Today</Title>
      <div className="mb-4 flex flex-wrap gap-4">
        <Link to="/history" className="text-base font-semibold text-[var(--accent)]">Past visits</Link>
        {profile && profile.role !== "visitor" ? <Link to="/pay" className="text-base font-semibold text-[var(--accent)]">Your pay</Link> : null}
        {profile && profile.role !== "visitor" ? <Link to="/charges" className="text-base font-semibold text-[var(--accent)]">Reimbursements</Link> : null}
        {profile && profile.role !== "visitor" ? <Link to="/coverage" className="text-base font-semibold text-[var(--accent)]">Coverage</Link> : null}
        {profile && profile.role !== "visitor" ? <Link to="/inventory" className="text-base font-semibold text-[var(--accent)]">Stock</Link> : null}
        {profile && profile.role !== "visitor" ? <Link to="/flags" className="text-base font-semibold text-[var(--accent)]">Flag stock</Link> : null}
      </div>
      {profile && profile.role !== "visitor" ? (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Link to="/flags" className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Out</p>
            <p className="text-2xl font-semibold">{board.data?.flagsMissing ? "—" : (counts?.out ?? "…")}</p>
          </Link>
          <Link to="/inventory" className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">To reorder</p>
            <p className="text-2xl font-semibold">{counts?.toReorder ?? "…"}</p>
          </Link>
          <Link to="/flags" className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Service flags</p>
            <p className="text-2xl font-semibold">{board.data?.flagsMissing ? "—" : (counts?.serviceFlags ?? "…")}</p>
          </Link>
          <Link to="/coverage" className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Coverage needed</p>
            <p className="text-2xl font-semibold">{board.data?.coverageMissing ? "—" : (counts?.coverageNeeded ?? "…")}</p>
          </Link>
        </div>
      ) : null}
      <Card className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{practice ? "Practice is on" : "Live visits"}</p>
            <p className="text-sm text-stone-600">
              {profile?.role === "trainee" ? "Trainees always stay in practice." : "Practice never changes live visits."}
            </p>
          </div>
          <Button tone={practice ? "primary" : "quiet"} disabled={profile?.role === "trainee"} onClick={() => void toggleMode()}>
            {practice ? "Exit" : "Practice"}
          </Button>
        </div>
      </Card>
      <div className="grid gap-3">
        {visible.map((site) => {
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
          const incompleteToday = !openVisit && completedToday.length === 0 && siteSessions.some((row) => row.status === "voided" && row.service_date === clock.today);
          const show = (shows.data ?? []).find((row) => row.site_id === site.id && row.date === clock.today);
          const previous =
            site.cadence === "daily" ? addDays(clock.today, -1) : site.cadence === "mwf" ? previousMwf(clock.today) : null;
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
            visitInProgress: Boolean((openVisit && !openVisit.end_at) || (draftMatches && draft?.sessionId && !pausedSource)),
            incompleteToday,
          });
          return (
            <Link key={site.id} to={`/service/${site.id}`} className="block rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xl font-semibold">{site.short_name}</div>
              <div className={`mt-2 text-base font-semibold ${status.beforeOpening || status.lateForShow ? "text-red-700" : "text-stone-800"}`}>
                {status.label}
              </div>
              {status.softHint ? (
                <p className={`mt-1 text-sm ${status.softHintActive ? "font-medium text-amber-800" : "text-stone-500"}`}>
                  {status.softHint}
                  {status.softHintActive ? " · lunch is busy" : ""}
                </p>
              ) : null}
            </Link>
          );
        })}
        {sites.isLoading ? <p className="text-stone-600">Loading sites…</p> : null}
        {!sites.isLoading && visible.length === 0 ? <p className="text-stone-600">No sites for this mode yet.</p> : null}
      </div>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
