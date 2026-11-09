import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { loadRecentSessions, loadShowDays, loadSites, type LocalVisit } from "../data";
import { recallVisit } from "../lib/sync";
import { formatTorontoTime, torontoNow } from "../lib/dates";
import { addDays, parseClock, previousMwf, visitStatus } from "../lib/due";
import { inPractice } from "../lib/access";
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

  async function toggleMode() {
    if (!profile || profile.role === "trainee") return;
    const next = profile.mode === "practice" ? "live" : "practice";
    const { error } = await supabase.rpc("set_mode", { p_mode: next });
    if (error) return;
    await queryClient.invalidateQueries();
  }

  const visible = (sites.data ?? []).filter((site) => site.is_sandbox === practice);
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
