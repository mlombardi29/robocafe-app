/** Helpers for the stock transaction history screen (E21). */

export type StockTxRow = {
  id: string;
  created_at: string;
  type: "receipt" | "withdrawal" | "adjustment";
  delta_base: number;
  note: string | null;
  location: string;
  site_id: string | null;
  sku_id: string;
  person_id: string | null;
  is_sandbox: boolean;
};

export function txTypeLabel(type: StockTxRow["type"]): string {
  if (type === "receipt") return "Add";
  if (type === "withdrawal") return "Take";
  return "Recount";
}

export function formatDelta(delta: number, unit: string | null): string {
  const signed = delta > 0 ? `+${delta}` : String(delta);
  return unit ? `${signed} ${unit}` : signed;
}

export function placeLabel(location: string, siteName: string | null): string {
  if (location === "dupont") return "Dupont";
  return siteName || "Site";
}
