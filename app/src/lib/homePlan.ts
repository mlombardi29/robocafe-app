import { addDays } from "./due";

export type Cadence = "daily" | "mwf" | "show_days";

export type PlanSite = {
  id: string;
  shortName: string;
  name: string;
  cadence: Cadence;
  active: boolean;
};

export type TodaySiteState = {
  siteId: string;
  due: boolean;
  completed: boolean;
  inProgress: boolean;
  paused: boolean;
  label: string;
};

export type OutstandingVisit = {
  siteId: string;
  shortName: string;
  name: string;
  action: "Start visit" | "Continue visit";
  detail: string;
};

export type ScheduledStop = {
  date: string;
  siteId: string;
  shortName: string;
  name: string;
};

export type ShowDay = { siteId: string; date: string; status: string | null };

/** Weekday of a calendar date. Noon UTC avoids a DST shift changing the day. */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

export function showScheduledOn(shows: ShowDay[], siteId: string, date: string): boolean {
  return shows.some((row) => row.siteId === siteId && row.date === date && row.status === "scheduled");
}

/** Daily is every day. Mon/Wed/Fri is those weekdays. A show site is due only on a scheduled show. */
export function isServiceDay(cadence: Cadence, weekday: number, showScheduled: boolean): boolean {
  if (cadence === "daily") return true;
  if (cadence === "mwf") return weekday === 1 || weekday === 3 || weekday === 5;
  return showScheduled;
}

export function outstandingVisits(sites: PlanSite[], states: TodaySiteState[]): OutstandingVisit[] {
  return sites.flatMap((site) => {
    if (!site.active) return [];
    const state = states.find((row) => row.siteId === site.id);
    if (!state?.due || state.completed) return [];
    return [
      {
        siteId: site.id,
        shortName: site.shortName,
        name: site.name,
        action: state.inProgress || state.paused ? "Continue visit" : "Start visit",
        detail: state.label,
      },
    ];
  });
}

/** The next calendar day, after today, that still has a service stop. */
export function nextServiceShifts(sites: PlanSite[], today: string, shows: ShowDay[], horizon = 21): ScheduledStop[] {
  const active = sites.filter((site) => site.active);
  for (let offset = 1; offset <= horizon; offset += 1) {
    const date = addDays(today, offset);
    const stops = stopsOn(active, date, shows);
    if (stops.length > 0) return stops;
  }
  return [];
}

/** Service stops from `from` inclusive, for `days` calendar days. */
export function upcomingServiceDays(sites: PlanSite[], from: string, shows: ShowDay[], days = 14): ScheduledStop[] {
  const active = sites.filter((site) => site.active);
  const rows: ScheduledStop[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    rows.push(...stopsOn(active, addDays(from, offset), shows));
  }
  return rows;
}

function stopsOn(sites: PlanSite[], date: string, shows: ShowDay[]): ScheduledStop[] {
  const weekday = weekdayOf(date);
  return sites
    .filter((site) => isServiceDay(site.cadence, weekday, showScheduledOn(shows, site.id, date)))
    .map((site) => ({ date, siteId: site.id, shortName: site.shortName, name: site.name }));
}

export function formatPlanDay(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
