import { describe, expect, it } from "vitest";
import {
  adjustStep,
  dupontGlanceStatus,
  locationStatusLabel,
  locationStockStatus,
  naturalAmount,
  nextWarehouseCount,
  toWarehouseRow,
  warehouseReorderSignal,
} from "./stockGlance";

const cupPacks = [
  { name: "sleeve", perBase: 50 },
  { name: "box", perBase: 1000 },
];

describe("stock glance", () => {
  it("shows a location as out, low, or OK and never a count", () => {
    expect(locationStockStatus([])).toBe("ok");
    expect(locationStockStatus([{ status: "low" }])).toBe("low");
    expect(locationStockStatus([{ status: "low" }, { status: "out" }])).toBe("out");
    expect(locationStatusLabel("ok")).toBe("OK");
    expect(locationStatusLabel("out")).toBe("Out");
  });

  it("signals a reorder at the threshold, below it, or at zero", () => {
    expect(warehouseReorderSignal({ onHand: 12, reorderBelow: 12 })).toBe(true);
    expect(warehouseReorderSignal({ onHand: 11, reorderBelow: 12 })).toBe(true);
    expect(warehouseReorderSignal({ onHand: 13, reorderBelow: 12 })).toBe(false);
    expect(warehouseReorderSignal({ onHand: 0, reorderBelow: null })).toBe(true);
    expect(warehouseReorderSignal({ onHand: 0, reorderBelow: 12, phaseOut: true })).toBe(false);
    expect(warehouseReorderSignal({ onHand: 4, reorderBelow: null })).toBe(false);
  });

  it("steps warehouse counts by one pack and saves a recount that cannot go below zero", () => {
    expect(adjustStep(cupPacks)).toEqual({ name: "box", perBase: 1000 });
    expect(adjustStep([{ name: "bag", perBase: 1 }])).toEqual({ name: "bag", perBase: 1 });
    expect(adjustStep([])).toEqual({ name: "unit", perBase: 1 });
    expect(nextWarehouseCount(2000, -1, 1000)).toBe(1000);
    expect(nextWarehouseCount(50, -1, 1000)).toBe(0);
    expect(nextWarehouseCount(1050, 1, 1000)).toBe(2050);
    expect(naturalAmount(1050, cupPacks, "cups")).toBe("1 box + 50 cups");
    expect(naturalAmount(0, cupPacks, "cups")).toBe("0 boxes");
    const row = toWarehouseRow({
      skuId: "cups",
      name: "12 oz hot cups",
      baseUnit: "cups",
      onHand: 0,
      reorderBelow: 1000,
      packs: cupPacks,
    });
    expect(row.reorder).toBe(true);
    expect(row.step.perBase).toBe(1000);
    expect(dupontGlanceStatus([row])).toBe("reorder");
  });
});
