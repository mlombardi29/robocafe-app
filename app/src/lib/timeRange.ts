/** Date windows for My Time. Days are YYYY-MM-DD. */

export type RangeKey = "this-week" | "past-week" | "this-month" | "past-month" | "past-year" | "custom";

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shift(day: string, days: number): string {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDay(date);
}

function mondayOf(day: string): string {
  const weekday = parseDay(day).getUTCDay();
  const fromMonday = (weekday + 6) % 7;
  return shift(day, -fromMonday);
}

export function rangeBounds(
  key: RangeKey,
  today: string,
  customFrom = "",
  customTo = "",
): { from: string; to: string } {
  if (key === "custom") {
    return { from: customFrom || today, to: customTo || today };
  }
  if (key === "this-week") {
    const start = mondayOf(today);
    return { from: start, to: shift(start, 6) };
  }
  if (key === "past-week") {
    const start = shift(mondayOf(today), -7);
    return { from: start, to: shift(start, 6) };
  }
  if (key === "this-month") {
    return { from: `${today.slice(0, 7)}-01`, to: today };
  }
  if (key === "past-month") {
    const firstThis = parseDay(`${today.slice(0, 7)}-01`);
    firstThis.setUTCDate(0);
    const last = formatDay(firstThis);
    return { from: `${last.slice(0, 7)}-01`, to: last };
  }
  const year = Number(today.slice(0, 4)) - 1;
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function durationMinutes(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
  if (!Number.isFinite(mins) || mins < 0) return null;
  return mins;
}

export function durationLabel(minutes: number | null): string {
  if (minutes == null) return "No duration";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function inRange(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}
