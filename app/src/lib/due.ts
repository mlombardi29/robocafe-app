export type CadenceType =
  | "every_visit"
  | "every_n_days"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "below_threshold"
  | "check_decide";

export type DueItem = {
  key: string;
  cadenceType: CadenceType;
  cadenceDays: number | null;
  status: "active" | "pending_validation";
  thresholdValue: number | null;
  thresholdUnit: string | null;
};

export type DueResult = {
  show: boolean;
  due: boolean;
  overdue: boolean;
  detail: string | null;
  placeholder: string | null;
  daysSince: number | null;
};

/** What a tech should read for a fill step. Does not invent a number. */
export function thresholdDetail(value: number | null, unit: string | null): string {
  const label = unit?.trim() ?? "";
  if (value == null) return label ? `Check. ${label}` : "Check. Fill if low.";
  const amount = Number(value);
  if (amount === 50 && label.includes("%")) return "Check. Fill only if below half.";
  if (amount === 67 && label.includes("%")) return "Check. Fill only if below two-thirds.";
  return `Check. Fill only if below ${amount}${label ? ` ${label}` : ""}.`;
}

export const ARM_SENSOR_PLACEHOLDER =
  "Pass/fail criteria are being confirmed with KioCafe (Albert Kim). For now, note what you see.";

const DAY = 86_400_000;

/** Whole days from the last-done calendar date to today. Null when never done. */
export function daysBetween(lastDoneAt: string | null, today: string): number | null {
  if (!lastDoneAt) return null;
  const last = lastDoneAt.slice(0, 10);
  const end = Date.parse(`${today}T00:00:00Z`);
  const start = Date.parse(`${last}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(start)) return null;
  return Math.floor((end - start) / DAY);
}

/** Answers whether an every-N-days step should be serviced today. Due once `since` reaches N. */
export function intervalStatus(since: number | null, n: number): { due: boolean; overdue: boolean; detail: string } {
  if (since == null) {
    return { due: true, overdue: false, detail: `Not recorded yet · needed every ${n} days` };
  }
  const day = since + 1;
  const until = n - since;
  if (until > 1) {
    return { due: false, overdue: false, detail: `Early. Day ${day} of ${n} — due in ${until} days` };
  }
  if (until === 1) {
    return { due: false, overdue: false, detail: `Early. Day ${day} of ${n} — due tomorrow` };
  }
  if (until === 0) {
    return { due: true, overdue: false, detail: `Due today. Last changed ${since} days ago · every ${n} days` };
  }
  return { due: true, overdue: true, detail: `Overdue. Done ${since} days ago · needed every ${n} days` };
}

function periodDays(item: DueItem): number | null {
  if (item.cadenceType === "weekly") return item.cadenceDays ?? 7;
  if (item.cadenceType === "biweekly") return item.cadenceDays ?? 14;
  if (item.cadenceType === "monthly") return item.cadenceDays ?? 30;
  if (item.cadenceType === "every_n_days") return item.cadenceDays;
  return null;
}

export function evaluateDue(item: DueItem, lastDoneAt: string | null, today: string): DueResult {
  const since = daysBetween(lastDoneAt, today);
  const placeholder = item.status === "pending_validation" ? ARM_SENSOR_PLACEHOLDER : null;

  if (item.key === "milk_bag" || item.cadenceType === "every_n_days") {
    const limit = item.cadenceDays ?? 4;
    const interval = intervalStatus(since, limit);
    return { show: true, ...interval, placeholder, daysSince: since };
  }

  if (item.key === "empty_pucks") {
    const overdue = since == null || since >= 2;
    const detail = overdue
      ? "Overdue. It has been 2 or more days since it was emptied."
      : "Early. Check the volume. Empty it when it is full, or at 2 days.";
    return { show: true, due: true, overdue, detail, placeholder, daysSince: since };
  }

  if (item.cadenceType === "below_threshold") {
    return { show: true, due: true, overdue: false, detail: thresholdDetail(item.thresholdValue, item.thresholdUnit), placeholder, daysSince: since };
  }

  if (item.cadenceType === "check_decide") {
    return { show: true, due: true, overdue: false, detail: "Check and decide.", placeholder, daysSince: since };
  }

  if (item.cadenceType === "every_visit") {
    return { show: true, due: true, overdue: false, detail: null, placeholder, daysSince: since };
  }

  const n = periodDays(item);
  if (n == null) {
    return { show: false, due: false, overdue: false, detail: null, placeholder, daysSince: since };
  }
  const due = since == null || since >= n;
  const detail =
    since == null
      ? `Not recorded yet · needed every ${n} days`
      : `${due ? "Due" : "Not due"}. Done ${since} day${since === 1 ? "" : "s"} ago · needed every ${n} days`;
  return { show: true, due, overdue: false, detail, placeholder, daysSince: since };
}

export type VisitInput = {
  cadence: "daily" | "mwf" | "show_days";
  /** "HH:MM" or null. Null keeps the Monday red flag off. */
  openingTime: string | null;
  active: boolean;
  weekday: number;
  nowMinutes: number;
  showStartMinutes: number | null;
  showStatus: string | null;
  startedToday: boolean;
  completedDates: string[];
  previousServiceDate: string | null;
  /** Open visit that already has a clock-out. */
  pausedTime?: string | null;
  /** Open visit with no clock-out yet. */
  visitInProgress?: boolean;
  /** Closed without completing, dated today. */
  incompleteToday?: boolean;
  /** Toronto time already formatted, when this site has a completed visit today. */
  completedTodayTime?: string | null;
};

export type VisitStatus = {
  due: boolean;
  missed: boolean;
  beforeOpening: boolean;
  lateForShow: boolean;
  label: string;
};

export function parseClock(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function visitStatus(input: VisitInput): VisitStatus {
  if (!input.active) {
    return {
      due: false,
      missed: false,
      beforeOpening: false,
      lateForShow: false,
      label: "Offline for the season",
    };
  }

  if (input.pausedTime) {
    return {
      due: true,
      missed: false,
      beforeOpening: false,
      lateForShow: false,
      label: `Paused · clocked out ${input.pausedTime}. Resume this visit.`,
    };
  }
  if (input.visitInProgress) {
    return {
      due: true,
      missed: false,
      beforeOpening: false,
      lateForShow: false,
      label: "Resume this visit.",
    };
  }
  if (input.incompleteToday) {
    return {
      due: false,
      missed: false,
      beforeOpening: false,
      lateForShow: false,
      label: "Incomplete today",
    };
  }

  if (input.completedTodayTime) {
    return {
      due: false,
      missed: false,
      beforeOpening: false,
      lateForShow: false,
      label: `Completed today ${input.completedTodayTime}`,
    };
  }

  const missed =
    input.previousServiceDate != null && !input.completedDates.includes(input.previousServiceDate);

  if (input.cadence === "show_days") {
    const on =
      input.showStatus === "scheduled" && input.showStartMinutes != null;
    if (!on) {
      return { due: false, missed: false, beforeOpening: false, lateForShow: false, label: "No show today" };
    }
    const late = !input.startedToday && input.nowMinutes > (input.showStartMinutes as number);
    return {
      due: true,
      missed: false,
      beforeOpening: false,
      lateForShow: late,
      label: late ? "Late. The show has started" : "Show day. Service before the show",
    };
  }

  const serviceDay =
    input.cadence === "daily" ||
    (input.cadence === "mwf" && (input.weekday === 1 || input.weekday === 3 || input.weekday === 5));

  if (!serviceDay) {
    return {
      due: false,
      missed,
      beforeOpening: false,
      lateForShow: false,
      label: missed ? "Missed the last visit" : "Not a service day",
    };
  }

  const opening = parseClock(input.openingTime);
  const beforeOpening =
    input.cadence === "mwf" &&
    input.weekday === 1 &&
    opening != null &&
    !input.startedToday &&
    input.nowMinutes >= opening;

  let label = "Due today";
  if (beforeOpening) label = "Due before opening";
  else if (missed) label = "Due today. Last visit was missed";

  return { due: true, missed, beforeOpening, lateForShow: false, label };
}

/** Previous Mon/Wed/Fri strictly before `today` (YYYY-MM-DD). */
export function previousMwf(today: string): string {
  const cursor = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i < 7; i += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const day = cursor.getUTCDay();
    if (day === 1 || day === 3 || day === 5) return cursor.toISOString().slice(0, 10);
  }
  return today;
}

export function addDays(today: string, delta: number): string {
  const cursor = new Date(`${today}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + delta);
  return cursor.toISOString().slice(0, 10);
}
