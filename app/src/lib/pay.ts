export type PayRate = { effectiveOn: string; hourlyRate: number };

/** Michael Nov 8: covered shifts pay the covering tech at their own hourly rate. */
export const COVERAGE_PAY_RULE = "worker_own_hourly_rate" as const;

/**
 * Who is paid for a completed visit. Always the person who worked it (session person),
 * never the original assignee and never a special coverage rate.
 */
export function payPersonForShift(workerPersonId: string, _originalAssigneeId?: string | null): string {
  return workerPersonId;
}

/** Rates used for a covered (or any) shift: the worker's rates only. */
export function ratesForShiftPay(
  workerRates: PayRate[],
  _originalAssigneeRates?: PayRate[],
): PayRate[] {
  return workerRates;
}

/** Latest rate whose effective date is on or before the shift. */
export function rateForDay(rates: PayRate[], day: string): number | null {
  const match = rates
    .filter((rate) => rate.effectiveOn <= day)
    .sort((a, b) => b.effectiveOn.localeCompare(a.effectiveOn))[0];
  return match?.hourlyRate ?? null;
}

/** Dollars for a shift, rounded to the cent. */
export function lineAmount(minutes: number, hourlyRate: number): number {
  if (minutes < 0 || hourlyRate < 0) return 0;
  return Math.round((minutes / 60) * hourlyRate * 100) / 100;
}

export function money(amount: number | null): string {
  if (amount == null || Number.isNaN(amount)) return "No amount";
  return `$${amount.toFixed(2)}`;
}

/** True when this completed visit was a claimed coverage day for that site. */
export function isCoveredShift(
  claims: { site_id: string; service_date: string; claimed_by: string | null }[],
  siteId: string,
  serviceDate: string,
  workerPersonId: string,
): boolean {
  return claims.some(
    (row) =>
      row.site_id === siteId &&
      row.service_date === serviceDate &&
      row.claimed_by === workerPersonId,
  );
}
