import { describe, expect, it } from "vitest";
import {
  BUY_MILK_HINT,
  DUPONT_ESPRESSO_FLOAT_DEFAULT,
  MILK_2PCT_FRIDGE_LITRES,
  WAREHOUSE_RULES,
  buyMilkOnTheWay,
  espressoFloatLevels,
  warehouseNeedsReorder,
  warehouseRuleLabel,
} from "./stockRules";
import { conversionLabel, onHandLabel, toBaseQty } from "./packEntry";

describe("stockRules Nov 13", () => {
  it("encodes oat milk as cartons with box-of-6 and 12/18 warehouse levels", () => {
    const oat = WAREHOUSE_RULES.find((row) => row.legacyId === "oat-milk")!;
    expect(oat.baseUnit).toBe("cartons");
    expect(oat.reorderBelow).toBe(12);
    expect(oat.target).toBe(18);
    expect(oat.packs.find((pack) => pack.name === "box")?.perBase).toBe(6);
    expect(toBaseQty({ kind: "pack", packId: "box" }, 2, [{ id: "box", name: "box", perBase: 6 }])).toBe(12);
  });

  it("derives espresso Dupont float reorder as target minus one bag", () => {
    expect(espressoFloatLevels(DUPONT_ESPRESSO_FLOAT_DEFAULT)).toEqual({ reorderBelow: 1, target: 2 });
    expect(espressoFloatLevels(4)).toEqual({ reorderBelow: 3, target: 4 });
  });

  it("counts cups in base units: sleeve 50, box 1000", () => {
    const hot = WAREHOUSE_RULES.find((row) => row.legacyId === "cups-12oz-hot")!;
    expect(hot.reorderBelow).toBe(1000);
    expect(hot.target).toBe(2000);
    expect(toBaseQty({ kind: "pack", packId: "sleeve" }, 1, [{ id: "sleeve", name: "sleeve", perBase: 50 }])).toBe(50);
    expect(conversionLabel({ kind: "pack", packId: "sleeve" }, 1, [{ id: "sleeve", name: "sleeve", perBase: 50 }], "cups")).toBe(
      "1 sleeve of 50 = 50 cups",
    );
  });

  it("marks 12 oz cold cups as phase-out with no reorder", () => {
    const cold = WAREHOUSE_RULES.find((row) => row.legacyId === "cups-12oz-cold")!;
    expect(cold.phaseOut).toBe(true);
    expect(cold.reorderBelow).toBeNull();
    expect(cold.target).toBeNull();
    expect(warehouseNeedsReorder(0, cold.reorderBelow)).toBe(false);
    expect(warehouseRuleLabel(cold)).toMatch(/Phase-out/);
  });

  it("keeps 2% milk as grocery with an 8 L fridge threshold", () => {
    const milk = WAREHOUSE_RULES.find((row) => row.legacyId === "milk-2pct")!;
    expect(milk.source).toBe("grocery");
    expect(milk.reorderBelow).toBeNull();
    expect(MILK_2PCT_FRIDGE_LITRES).toBe(8);
    expect(milk.packs[0]).toEqual({ name: "4 L pack", perBase: 4 });
  });

  it("shows Buy milk on the way from an open flag or fridge shortfall", () => {
    expect(
      buyMilkOnTheWay({
        siteId: "uoft",
        milkSkuId: "milk",
        openFlags: [{ site_id: "uoft", sku_id: "milk", status: "low", resolved_at: null }],
        siteOnHandLitres: 20,
      }),
    ).toBe(true);
    expect(
      buyMilkOnTheWay({
        siteId: "uoft",
        milkSkuId: "milk",
        openFlags: [],
        siteOnHandLitres: 7,
      }),
    ).toBe(true);
    expect(
      buyMilkOnTheWay({
        siteId: "uoft",
        milkSkuId: "milk",
        openFlags: [],
        siteOnHandLitres: 8,
      }),
    ).toBe(false);
    expect(BUY_MILK_HINT).toBe("Buy milk on the way");
  });

  it("labels on-hand with pack breakdown for cups", () => {
    expect(
      onHandLabel(1050, "cups", [
        { id: "sleeve", name: "sleeve", perBase: 50 },
        { id: "box", name: "box", perBase: 1000 },
      ]),
    ).toContain("box");
  });
});
