export type PayRate = { effectiveOn: string; hourlyRate: number };

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
