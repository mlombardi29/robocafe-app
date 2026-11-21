import { rangeBounds } from "./timeRange";

export type PayWindow = { from: string; to: string };

export type PeriodShift = {
  date: string;
  site: string;
  minutes: number | null;
  amount: number | null;
};

export type PeriodReimbursement = {
  date: string;
  note: string;
  amount: number | null;
};

export type PayPeriodDetail = {
  from: string;
  to: string;
  shifts: PeriodShift[];
  reimbursements: PeriodReimbursement[];
  total: number;
};

/** Monday–Sunday week that contains `day`. Same bounds as payroll. */
export function currentPayPeriod(day: string): PayWindow {
  return rangeBounds("this-week", day);
}

export function previousPayPeriod(period: PayWindow): PayWindow {
  return rangeBounds("past-week", period.from);
}

export function inPayPeriod(date: string, period: PayWindow): boolean {
  return date >= period.from && date <= period.to;
}

export function sumMoney(amounts: (number | null | undefined)[]): number {
  const total = amounts.reduce<number>((sum, amount) => sum + (amount == null || Number.isNaN(amount) ? 0 : amount), 0);
  return Math.round(total * 100) / 100;
}

/** Shifts and reimbursements inside one period. No rate and no covered/scheduled label. */
export function buildPayPeriod(input: {
  from: string;
  to: string;
  shifts: PeriodShift[];
  reimbursements: PeriodReimbursement[];
}): PayPeriodDetail {
  const period = { from: input.from, to: input.to };
  const shifts = input.shifts
    .filter((row) => inPayPeriod(row.date, period))
    .sort((a, b) => a.date.localeCompare(b.date) || a.site.localeCompare(b.site));
  const reimbursements = input.reimbursements
    .filter((row) => inPayPeriod(row.date, period))
    .sort((a, b) => a.date.localeCompare(b.date) || a.note.localeCompare(b.note));
  return {
    from: input.from,
    to: input.to,
    shifts,
    reimbursements,
    total: sumMoney([...shifts.map((row) => row.amount), ...reimbursements.map((row) => row.amount)]),
  };
}

/** Earlier weeks that contain a shift or a reimbursement, newest first. */
export function pastPayPeriods(today: string, activityDates: string[], limit = 12): PayWindow[] {
  const dates = activityDates.filter(Boolean);
  const found: PayWindow[] = [];
  let cursor = currentPayPeriod(today).from;
  for (let i = 0; i < 60 && found.length < limit; i += 1) {
    const prev = previousPayPeriod({ from: cursor, to: cursor });
    if (dates.some((date) => inPayPeriod(date, prev))) found.push(prev);
    if (prev.from <= "2020-01-01") break;
    cursor = prev.from;
  }
  return found;
}
