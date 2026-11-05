const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type TorontoNow = {
  today: string;
  weekday: number;
  nowMinutes: number;
  timeLabel: string;
};

export function torontoNow(date = new Date()): TorontoNow {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  const minute = Number(parts.minute);
  return {
    today: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY[parts.weekday] ?? 0,
    nowMinutes: hour * 60 + minute,
    timeLabel: `${hour}:${String(minute).padStart(2, "0")}`,
  };
}

/** A clock time on a Toronto calendar day, as an ISO timestamp. */
export function instantOnTorontoDay(day: string, hhmm: string): string {
  const [hour, minute] = hhmm.split(":").map(Number);
  const desired = hour * 60 + minute;
  const anchor = Date.parse(`${day}T12:00:00Z`);
  for (let delta = -20 * 60; delta <= 20 * 60; delta += 1) {
    const candidate = new Date(anchor + delta * 60_000);
    const parts = torontoNow(candidate);
    if (parts.today === day && parts.nowMinutes === desired) return candidate.toISOString();
  }
  return new Date(anchor).toISOString();
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "Not set";
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
