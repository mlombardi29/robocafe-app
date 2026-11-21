import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { loadShowDays, loadSites } from "../data";
import { inPractice } from "../lib/access";
import { torontoNow } from "../lib/dates";
import { formatPlanDay, upcomingServiceDays, type PlanSite, type ShowDay } from "../lib/homePlan";
import { Screen, Title } from "../ui";
import { CoveragePage } from "./Coverage";
import { HistoryPage } from "./History";

export function SchedulePage() {
  const { profile } = useAuth();
  const clock = torontoNow();
  const practice = profile ? inPractice(profile.role, profile.mode) : false;
  const sites = useQuery({ queryKey: ["sites", profile?.id, profile?.mode], enabled: Boolean(profile), queryFn: loadSites });
  const shows = useQuery({
    queryKey: ["shows", clock.today],
    enabled: Boolean(profile),
    queryFn: () => loadShowDays(clock.today),
  });
  const visible = (sites.data ?? []).filter((site) => site.is_sandbox === practice && site.active);
  const planSites: PlanSite[] = visible.map((site) => ({
    id: site.id,
    shortName: site.short_name,
    name: site.name,
    cadence: site.cadence,
    active: site.active,
  }));
  const showDays: ShowDay[] = (shows.data ?? []).map((row) => ({
    siteId: row.site_id,
    date: row.date,
    status: row.status ?? null,
  }));
  const upcoming = upcomingServiceDays(planSites, clock.today, showDays, 14);
  const groups = new Map<string, typeof upcoming>();
  for (const stop of upcoming) groups.set(stop.date, [...(groups.get(stop.date) ?? []), stop]);

  return (
    <Screen>
      <Title sub="Your service days, coverage, and past visits.">Schedule</Title>
      <section>
        <h2 className="mb-2 text-xl font-semibold">Coming up</h2>
        {sites.isLoading ? <p className="text-stone-600">Loading…</p> : null}
        {!sites.isLoading && groups.size === 0 ? <p className="text-stone-600">Nothing on the schedule in the next two weeks.</p> : null}
        <div className="grid gap-3">
          {[...groups.entries()].map(([date, stops]) => (
            <div key={date} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
              <p className="text-sm font-semibold uppercase tracking-wide text-stone-500">{formatPlanDay(date)}</p>
              <ul className="mt-2 grid gap-2">
                {stops.map((stop) =>
                  date === clock.today ? (
                    <li key={stop.siteId}>
                      <Link to={`/service/${stop.siteId}`} className="flex min-h-12 items-center justify-between text-lg font-semibold">
                        <span>{stop.shortName}</span>
                        <span className="text-sm font-semibold text-[var(--accent)]">Open</span>
                      </Link>
                    </li>
                  ) : (
                    <li key={stop.siteId} className="flex min-h-12 items-center text-lg font-semibold">
                      {stop.shortName}
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      </section>
      <div className="mt-8">
        <CoveragePage bare />
      </div>
      <div className="mt-8">
        <HistoryPage bare />
        <Link to="/time" className="mt-3 inline-block text-base font-semibold text-[var(--accent)]">Hours and corrections</Link>
      </div>
    </Screen>
  );
}
