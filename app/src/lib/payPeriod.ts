import { rangeBounds } from "./timeRange";

export type PayWindow = { from: string; to: string };

export type PeriodShift = {
  date: string;
  site: string;
  minutes: number | null;
  amount: number | null;
};

export type PeriodTrip = {
  id?: string;
  date: string;
  kind: "warehouse_pickup" | "milk_run";
  sites: string[];
  note: string;
  amount: number | null;
  voided?: boolean;
  milkCost?: number | null;
  receiptReceived?: boolean;
  createdAt?: string;
  personId?: string;
  paymentStatus?: string | null;
};

export type PeriodReimbursement = {
  date: string;
  note: string;
  amount: number | null;
  /** Milk cost waiting for an admin to mark the receipt received. Not in the subtotal. */
  held?: boolean;
  /** Already paid on the Charges page. In the statement total, skipped when the week is marked paid. */
  alreadyPaid?: boolean;
};

export type PayPeriodDetail = {
  from: string;
  to: string;
  shifts: PeriodShift[];
  trips: PeriodTrip[];
  reimbursements: PeriodReimbursement[];
  shiftsTotal: number;
  tripsTotal: number;
  reimbursementsTotal: number;
  alreadyPaidTotal: number;
  total: number;
  toPay: number;
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

/**
 * Shifts, trips, and reimbursements inside one period.
 * Voided trips are omitted. A held milk receipt is listed and kept out of the
 * totals. An already-paid reimbursement stays in the statement total and is
 * left out of toPay so marking the week paid does not pay it again.
 */
export function buildPayPeriod(input: {
  from: string;
  to: string;
  shifts: PeriodShift[];
  trips?: PeriodTrip[];
  reimbursements: PeriodReimbursement[];
}): PayPeriodDetail {
  const period = { from: input.from, to: input.to };
  const shifts = input.shifts
    .filter((row) => inPayPeriod(row.date, period))
    .sort((a, b) => a.date.localeCompare(b.date) || a.site.localeCompare(b.site));
  const trips = (input.trips ?? [])
    .filter((row) => !row.voided && inPayPeriod(row.date, period))
    .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.sites.join().localeCompare(b.sites.join()));
  const reimbursements = input.reimbursements
    .filter((row) => inPayPeriod(row.date, period))
    .sort((a, b) => a.date.localeCompare(b.date) || a.note.localeCompare(b.note));
  const shiftsTotal = sumMoney(shifts.map((row) => row.amount));
  const tripsTotal = sumMoney(trips.map((row) => row.amount));
  const counted = reimbursements.filter((row) => !row.held);
  const reimbursementsTotal = sumMoney(counted.map((row) => row.amount));
  const alreadyPaidTotal = sumMoney(counted.filter((row) => row.alreadyPaid).map((row) => row.amount));
  const payableReimbursements = sumMoney(counted.filter((row) => !row.alreadyPaid).map((row) => row.amount));
  return {
    from: input.from,
    to: input.to,
    shifts,
    trips,
    reimbursements,
    shiftsTotal,
    tripsTotal,
    reimbursementsTotal,
    alreadyPaidTotal,
    total: sumMoney([shiftsTotal, tripsTotal, reimbursementsTotal]),
    toPay: sumMoney([shiftsTotal, tripsTotal, payableReimbursements]),
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
