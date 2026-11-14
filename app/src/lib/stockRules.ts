/**
 * Michael-approved Dupont / grocery stock rules (Nov 13).
 * Ledger stays in base units; packs are display/entry only.
 * Target = reorder threshold + one order (where an order size is defined).
 */

export type SeedPack = { name: string; perBase: number };

export type WarehouseRule = {
  legacyId: string;
  name: string;
  baseUnit: string;
  category: string;
  source: "dupont" | "grocery";
  /** Warehouse reorder floor in base units. Null = no reorder (sell-through / grocery). */
  reorderBelow: number | null;
  /** Warehouse target in base units. Null = none. */
  target: number | null;
  packs: SeedPack[];
  phaseOut?: boolean;
  note?: string;
};

/** Default Dupont espresso float (bags). Admin-editable via config; rises when a new espresso kiosk opens. */
export const DUPONT_ESPRESSO_FLOAT_KEY = "dupont_espresso_float_bags";
export const DUPONT_ESPRESSO_FLOAT_DEFAULT = 2;
/** One bag is one order for espresso float math. */
export const ESPRESSO_ORDER_BAGS = 1;

export function espressoFloatLevels(floatBags: number): { reorderBelow: number; target: number } {
  const target = Math.max(ESPRESSO_ORDER_BAGS, Math.floor(floatBags));
  return { reorderBelow: Math.max(0, target - ESPRESSO_ORDER_BAGS), target };
}

/** 2% milk fridge flag threshold at every kiosk with a fridge (litres). */
export const MILK_2PCT_FRIDGE_LITRES = 8;
export const MILK_2PCT_LEGACY_ID = "milk-2pct";
export const BUY_MILK_HINT = "Buy milk on the way";

export const WAREHOUSE_RULES: WarehouseRule[] = [
  {
    legacyId: "oat-milk",
    name: "Oat milk",
    baseUnit: "cartons",
    category: "Milk",
    source: "dupont",
    // 1 box = 6 × 946 mL cartons. Reorder < 2 boxes, target 3 boxes.
    reorderBelow: 12,
    target: 18,
    packs: [
      { name: "carton", perBase: 1 },
      { name: "box", perBase: 6 },
    ],
    note: "1 carton = 946 mL. 1 box = 6 cartons.",
  },
  {
    legacyId: "espresso-beans",
    name: "Espresso beans",
    baseUnit: "bags",
    category: "Coffee",
    source: "dupont",
    reorderBelow: espressoFloatLevels(DUPONT_ESPRESSO_FLOAT_DEFAULT).reorderBelow,
    target: espressoFloatLevels(DUPONT_ESPRESSO_FLOAT_DEFAULT).target,
    packs: [{ name: "bag", perBase: 1 }],
    note: "Dupont float — admin-editable; rises when a new espresso kiosk opens.",
  },
  {
    legacyId: "cups-12oz-hot",
    name: "12 oz hot cups",
    baseUnit: "cups",
    category: "Cups",
    source: "dupont",
    reorderBelow: 1000,
    target: 2000,
    packs: [
      { name: "sleeve", perBase: 50 },
      { name: "box", perBase: 1000 },
    ],
    note: "1 sleeve = 50 cups. 1 box = 20 sleeves = 1,000 cups. Count in cups.",
  },
  {
    legacyId: "cups-16oz-cold",
    name: "16 oz cold cups",
    baseUnit: "cups",
    category: "Cups",
    source: "dupont",
    reorderBelow: 1000,
    target: 2000,
    packs: [
      { name: "sleeve", perBase: 50 },
      { name: "box", perBase: 1000 },
    ],
    note: "Same packing as 12 oz hot cups.",
  },
  {
    legacyId: "lids",
    name: "Lids",
    baseUnit: "lids",
    category: "Cups",
    source: "dupont",
    reorderBelow: 1000,
    target: 2000,
    packs: [{ name: "box", perBase: 1000 }],
    note: "1 box = 1,000 lids. Every drink uses one lid.",
  },
  {
    legacyId: "cups-12oz-cold",
    name: "12 oz cold cups",
    baseUnit: "cups",
    category: "Cups",
    source: "dupont",
    reorderBelow: null,
    target: null,
    packs: [
      { name: "sleeve", perBase: 50 },
      { name: "box", perBase: 1000 },
    ],
    phaseOut: true,
    note: "Phasing out — sell-through only. No reorder, no target.",
  },
  {
    legacyId: "milk-bag-10l",
    name: "Milk bags 10 L",
    baseUnit: "bags",
    category: "Milk",
    source: "dupont",
    reorderBelow: 20,
    target: 30,
    packs: [{ name: "pack", perBase: 10 }],
    note: "1 pack = 10 bags.",
  },
  {
    legacyId: "milk-bag-20l",
    name: "Milk bags 20 L",
    baseUnit: "bags",
    category: "Milk",
    source: "dupont",
    reorderBelow: 20,
    target: 30,
    packs: [{ name: "pack", perBase: 10 }],
    note: "1 pack = 10 bags.",
  },
  {
    legacyId: "uoft-coffee-concentrate",
    name: "UofT coffee concentrate",
    baseUnit: "bottles",
    category: "Coffee",
    source: "dupont",
    reorderBelow: 8,
    target: 12,
    packs: [{ name: "box", perBase: 4 }],
    note: "1 box = 4 bottles.",
  },
  {
    legacyId: MILK_2PCT_LEGACY_ID,
    name: "2% milk",
    baseUnit: "L",
    category: "Milk",
    source: "grocery",
    reorderBelow: null,
    target: null,
    packs: [{ name: "4 L pack", perBase: 4 }],
    note: "Grocery as-needed, not warehouse stock. Fridge flag below 8 L (2 packs of 3 bags ≈ 1.33 L).",
  },
];

/** Warehouse SKU needs reorder when Dupont on-hand is strictly below threshold. */
export function warehouseNeedsReorder(onHand: number, reorderBelow: number | null): boolean {
  if (reorderBelow == null || !Number.isFinite(reorderBelow)) return false;
  return onHand < Number(reorderBelow);
}

/** Plain-language warehouse line using packs when helpful. */
export function warehouseRuleLabel(rule: Pick<WarehouseRule, "reorderBelow" | "target" | "baseUnit" | "packs" | "phaseOut">): string {
  if (rule.phaseOut) return "Phase-out · sell-through only (no reorder)";
  if (rule.reorderBelow == null && rule.target == null) return "No warehouse reorder";
  const unit = rule.baseUnit;
  const box = rule.packs.find((pack) => pack.name === "box" || pack.name === "pack");
  const reorder = rule.reorderBelow;
  const target = rule.target;
  if (box && reorder != null && target != null && reorder % box.perBase === 0 && target % box.perBase === 0) {
    return `Reorder below ${reorder / box.perBase} ${box.name}${reorder / box.perBase === 1 ? "" : "s"} (${reorder} ${unit}) · target ${target / box.perBase} ${box.name}s (${target} ${unit})`;
  }
  const parts: string[] = [];
  if (reorder != null) parts.push(`Reorder below ${reorder} ${unit}`);
  if (target != null) parts.push(`target ${target} ${unit}`);
  return parts.join(" · ");
}

/**
 * True when the next tech for a site should see "Buy milk on the way".
 * Uses an open grocery milk flag, or site on-hand below the fridge threshold when known.
 */
export function buyMilkOnTheWay(input: {
  siteId: string;
  milkSkuId: string | null;
  openFlags: { site_id: string; sku_id: string | null; status: string; resolved_at: string | null }[];
  siteOnHandLitres: number | null;
  fridgeThresholdLitres?: number;
}): boolean {
  const threshold = input.fridgeThresholdLitres ?? MILK_2PCT_FRIDGE_LITRES;
  const flagged = input.openFlags.some(
    (row) =>
      !row.resolved_at &&
      row.site_id === input.siteId &&
      input.milkSkuId != null &&
      row.sku_id === input.milkSkuId,
  );
  if (flagged) return true;
  if (input.siteOnHandLitres == null || !Number.isFinite(input.siteOnHandLitres)) return false;
  return input.siteOnHandLitres < threshold;
}
