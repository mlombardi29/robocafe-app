import { formatQty } from "./packEntry";

export type PackSize = { name: string; perBase: number };

export type LocationFlag = { status: "low" | "out" };

/** A kiosk shows one status. Out wins over low. No quantities. */
export function locationStockStatus(flags: LocationFlag[]): "ok" | "low" | "out" {
  if (flags.some((flag) => flag.status === "out")) return "out";
  if (flags.some((flag) => flag.status === "low")) return "low";
  return "ok";
}

export function locationStatusLabel(status: "ok" | "low" | "out"): string {
  if (status === "out") return "Out";
  if (status === "low") return "Low";
  return "OK";
}

/**
 * Admin reorder signal: at or below the reorder threshold, or already at zero.
 * Phase-out items are sell-through and are not a reorder.
 */
export function warehouseReorderSignal(input: {
  onHand: number;
  reorderBelow: number | null;
  phaseOut?: boolean;
}): boolean {
  if (input.phaseOut) return false;
  if (!Number.isFinite(input.onHand)) return false;
  if (input.onHand <= 0) return true;
  if (input.reorderBelow == null || !Number.isFinite(input.reorderBelow)) return false;
  return input.onHand <= input.reorderBelow;
}

/** One tap moves one box, bag, or pack. The largest pack is that step. No pack means one base unit. */
export function adjustStep(packs: PackSize[]): PackSize {
  const usable = packs.filter((pack) => Number.isFinite(pack.perBase) && pack.perBase > 0);
  if (usable.length === 0) return { name: "unit", perBase: 1 };
  return usable.reduce((best, pack) => (pack.perBase > best.perBase ? pack : best));
}

/** Next on-hand after `steps` taps. Never goes below zero. */
export function nextWarehouseCount(onHand: number, steps: number, stepBase: number): number {
  const step = stepBase > 0 ? stepBase : 1;
  const next = onHand + steps * step;
  return next < 0 ? 0 : next;
}

export function pluralPack(name: string, count: number): string {
  if (count === 1) return name;
  if (name === "box") return "boxes";
  if (name.endsWith("s")) return name;
  return `${name}s`;
}

/** Amount in the natural pack, with a base-unit remainder when the count is not a whole pack. */
export function naturalAmount(onHand: number, packs: PackSize[], baseUnit: string | null | undefined): string {
  const step = adjustStep(packs);
  const unit = (baseUnit ?? "").trim() || "units";
  if (step.perBase <= 1) {
    const name = step.name === "unit" ? unit : pluralPack(step.name, onHand);
    return `${formatQty(onHand)} ${name}`;
  }
  const whole = Math.trunc(onHand / step.perBase);
  const remainder = onHand - whole * step.perBase;
  const wholeLabel = `${formatQty(whole)} ${pluralPack(step.name, whole)}`;
  if (Math.abs(remainder) < 1e-9) return wholeLabel;
  return `${wholeLabel} + ${formatQty(remainder)} ${unit}`;
}

export type WarehouseRowInput = {
  skuId: string;
  name: string;
  baseUnit: string | null;
  onHand: number;
  reorderBelow: number | null;
  phaseOut?: boolean;
  packs: PackSize[];
};

export type WarehouseRow = WarehouseRowInput & {
  reorder: boolean;
  step: PackSize;
  amount: string;
};

export function toWarehouseRow(input: WarehouseRowInput): WarehouseRow {
  const step = adjustStep(input.packs);
  return {
    ...input,
    reorder: warehouseReorderSignal(input),
    step,
    amount: naturalAmount(input.onHand, input.packs, input.baseUnit),
  };
}

export function dupontGlanceStatus(rows: { reorder: boolean }[]): "ok" | "reorder" {
  return rows.some((row) => row.reorder) ? "reorder" : "ok";
}
