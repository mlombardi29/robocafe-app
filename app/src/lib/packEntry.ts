/** Pack ↔ base-unit entry helpers. Ledger stays in base units; conversion is display/entry only. */

export type PackOption = {
  id: string;
  name: string;
  perBase: number;
};

export type EntryMode = { kind: "base" } | { kind: "pack"; packId: string };

export function positivePerBase(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function resolvePack(packs: PackOption[], packId: string): PackOption | null {
  return packs.find((pack) => pack.id === packId) ?? null;
}

/** Convert an entered quantity into base units for record_stock. */
export function toBaseQty(mode: EntryMode, qty: number, packs: PackOption[]): number | null {
  if (!Number.isFinite(qty)) return null;
  if (mode.kind === "base") return qty;
  const pack = resolvePack(packs, mode.packId);
  const per = pack ? positivePerBase(pack.perBase) : null;
  if (!pack || per == null) return null;
  return qty * per;
}

/**
 * Human conversion line, e.g. "2 sleeves of 50 = 100 cups".
 * Uses the SKU's stored pack name and base_unit; does not invent terminology.
 */
export function conversionLabel(
  mode: EntryMode,
  qty: number,
  packs: PackOption[],
  baseUnit: string | null | undefined,
): string | null {
  if (!Number.isFinite(qty)) return null;
  const unit = (baseUnit ?? "").trim() || "base units";
  if (mode.kind === "base") {
    return `${formatQty(qty)} ${unit}`;
  }
  const pack = resolvePack(packs, mode.packId);
  const per = pack ? positivePerBase(pack.perBase) : null;
  if (!pack || per == null) return null;
  const base = qty * per;
  return `${formatQty(qty)} ${pack.name} of ${formatQty(per)} = ${formatQty(base)} ${unit}`;
}

export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
}

/** On-hand shown with optional pack breakdown when packs exist. */
export function onHandLabel(onHandBase: number, baseUnit: string | null | undefined, packs: PackOption[]): string {
  const unit = (baseUnit ?? "").trim();
  const base = `${formatQty(onHandBase)}${unit ? ` ${unit}` : ""}`;
  if (packs.length === 0) return base;
  const parts = packs
    .map((pack) => {
      const per = positivePerBase(pack.perBase);
      if (per == null) return null;
      const whole = Math.floor(onHandBase / per);
      const rem = onHandBase - whole * per;
      if (whole <= 0 && rem === onHandBase) return null;
      return `${formatQty(whole)} ${pack.name}${rem ? ` + ${formatQty(rem)}${unit ? ` ${unit}` : ""}` : ""}`;
    })
    .filter(Boolean);
  if (parts.length === 0) return base;
  return `${base} (${parts.join("; ")})`;
}
