import { formatTorontoTime, instantOnTorontoDay, torontoNow } from "./dates";
import { durationMinutes } from "./timeRange";

/** Plain length for a correction, such as "21 min" or "1 hr". */
export function glanceDuration(minutes: number | null): string {
  if (minutes == null) return "No duration";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourLabel = `${hours} hr`;
  return rest ? `${hourLabel} ${rest} min` : hourLabel;
}

/** Signed difference between the length they want and the length charged. */
export function glanceDelta(current: number | null, wanted: number | null): string {
  if (current == null || wanted == null) return "No duration";
  const delta = wanted - current;
  if (delta === 0) return "Same length";
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${glanceDuration(Math.abs(delta))}`;
}

export function formatVisitDay(day: string): string {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(instantOnTorontoDay(day, "12:00")));
  return label.replace(",", "");
}

export function formatFriendlyTime(iso: string | null): string {
  if (!iso) return "";
  return formatTorontoTime(iso).replace(/\s*([AP]M)$/i, (_match, ap: string) => ` ${ap.toLowerCase()}`);
}

export function formatClockRange(start: string | null, end: string | null): string {
  const from = formatFriendlyTime(start);
  const to = formatFriendlyTime(end);
  if (from && to) {
    const fromParts = /^(.*)\s(am|pm)$/.exec(from);
    const toParts = /^(.*)\s(am|pm)$/.exec(to);
    if (fromParts && toParts && fromParts[2] === toParts[2]) return `${fromParts[1]}–${toParts[1]} ${toParts[2]}`;
    return `${from}–${to}`;
  }
  if (from) return `Starts ${from}`;
  if (to) return `Ends ${to}`;
  return "No times";
}

export type CorrectionGlance = {
  currentDay: string;
  currentRange: string;
  currentDuration: string;
  wantedDay: string;
  wantedRange: string;
  wantedDuration: string;
  delta: string;
  timesChanged: boolean;
};

function sameClock(requested: string | null, current: string | null): boolean {
  if (!requested) return true;
  if (!current) return false;
  return new Date(requested).getTime() === new Date(current).getTime();
}

export function correctionGlance(input: {
  serviceDate: string;
  startAt: string | null;
  endAt: string | null;
  requestedStart: string | null;
  requestedEnd: string | null;
}): CorrectionGlance {
  const wantedStart = input.requestedStart ?? input.startAt;
  const wantedEnd = input.requestedEnd ?? input.endAt;
  const wantedDay = wantedStart ? torontoNow(new Date(wantedStart)).today : input.serviceDate;
  return {
    currentDay: formatVisitDay(input.serviceDate),
    currentRange: formatClockRange(input.startAt, input.endAt),
    currentDuration: glanceDuration(durationMinutes(input.startAt, input.endAt)),
    wantedDay: formatVisitDay(wantedDay),
    wantedRange: formatClockRange(wantedStart, wantedEnd),
    wantedDuration: glanceDuration(durationMinutes(wantedStart, wantedEnd)),
    delta: glanceDelta(durationMinutes(input.startAt, input.endAt), durationMinutes(wantedStart, wantedEnd)),
    timesChanged: !sameClock(input.requestedStart, input.startAt) || !sameClock(input.requestedEnd, input.endAt),
  };
}

export function glanceText(glance: CorrectionGlance): string {
  const wantedWhen = glance.timesChanged
    ? `${glance.wantedDay === glance.currentDay ? "" : `${glance.wantedDay} `}${glance.wantedRange}`
    : "Same times";
  return [
    glance.currentDay,
    `Charged ${glance.currentDuration}`,
    glance.currentRange,
    `Wants ${glance.wantedDuration}`,
    wantedWhen,
    glance.delta,
  ].join("\n");
}
