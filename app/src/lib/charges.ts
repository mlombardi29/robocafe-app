/** Reimbursement charge helpers. Receipt URL is optional text until Drive is activated. */

export type ChargeRow = {
  id: string;
  person_id: string;
  site_id: string | null;
  amount: number | null;
  note: string | null;
  receipt_url: string | null;
  paid: boolean;
  created_at?: string;
};

export function parseChargeAmount(raw: string): number | null {
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Accept blank (Drive later) or a non-empty trimmed string. Do not invent a Drive file. */
export function normalizeReceiptUrl(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

export function unpaidCharges(rows: ChargeRow[]): ChargeRow[] {
  return rows.filter((row) => !row.paid).sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

export function money(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  return `$${Number(amount).toFixed(2)}`;
}
