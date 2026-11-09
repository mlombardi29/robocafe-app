/** E9 ops board counts. Uses existing flags/levels/coverage only — no invented thresholds. */

import { openCoverage, type CoverageRow } from "./coverage";

export type FlagCountRow = { status: "low" | "out"; site_id: string; resolved_at: string | null };
export type LevelRow = { site_id: string; sku_id: string; low_threshold: number | null };
export type OnHandKey = { site_id: string; sku_id: string; onHand: number };

export type OpsBoardCounts = {
  out: number;
  toReorder: number;
  serviceFlags: number;
  coverageNeeded: number;
};

export function countOpenFlags(flags: FlagCountRow[], siteIds?: string[]): { out: number; serviceFlags: number } {
  const allowed = siteIds ? new Set(siteIds) : null;
  let out = 0;
  let serviceFlags = 0;
  for (const row of flags) {
    if (row.resolved_at) continue;
    if (allowed && !allowed.has(row.site_id)) continue;
    serviceFlags += 1;
    if (row.status === "out") out += 1;
  }
  return { out, serviceFlags };
}

/** Count site×SKU rows where a low_threshold is set and on-hand is strictly below it. Blank thresholds are ignored. */
export function countBelowReorder(levels: LevelRow[], onHand: OnHandKey[], siteIds?: string[]): number {
  const allowed = siteIds ? new Set(siteIds) : null;
  const stock = new Map(onHand.map((row) => [`${row.site_id}:${row.sku_id}`, row.onHand]));
  let n = 0;
  for (const row of levels) {
    if (allowed && !allowed.has(row.site_id)) continue;
    if (row.low_threshold == null || !Number.isFinite(Number(row.low_threshold))) continue;
    const hand = stock.get(`${row.site_id}:${row.sku_id}`) ?? 0;
    if (hand < Number(row.low_threshold)) n += 1;
  }
  return n;
}

export function opsBoardCounts(input: {
  flags: FlagCountRow[];
  levels: LevelRow[];
  onHand: OnHandKey[];
  coverage: CoverageRow[];
  today: string;
  siteIds?: string[];
}): OpsBoardCounts {
  const { out, serviceFlags } = countOpenFlags(input.flags, input.siteIds);
  return {
    out,
    toReorder: countBelowReorder(input.levels, input.onHand, input.siteIds),
    serviceFlags,
    coverageNeeded: openCoverage(input.coverage, input.today).filter((row) => !input.siteIds || input.siteIds.includes(row.site_id))
      .length,
  };
}

/** Suggested Dupont take: shortfall vs target, capped by Dupont on-hand when known. Blank target → null (caller defaults). */
export function suggestedPickupQty(input: {
  siteOnHand: number;
  target: number | null;
  dupontOnHand: number | null;
}): number | null {
  if (input.target == null || !Number.isFinite(input.target)) return null;
  const need = Math.max(0, Number(input.target) - input.siteOnHand);
  if (need <= 0) return 0;
  if (input.dupontOnHand == null || !Number.isFinite(input.dupontOnHand)) return need;
  return Math.min(need, Math.max(0, input.dupontOnHand));
}

export function sumOnHand(
  txs: { sku_id: string; site_id: string | null; location: string; delta_base: number; is_sandbox: boolean }[],
  practice: boolean,
): OnHandKey[] {
  const map = new Map<string, number>();
  for (const row of txs) {
    if (row.is_sandbox !== practice) continue;
    if (row.location === "dupont" || row.site_id == null) {
      const key = `dupont:${row.sku_id}`;
      map.set(key, (map.get(key) ?? 0) + Number(row.delta_base));
      continue;
    }
    const key = `${row.site_id}:${row.sku_id}`;
    map.set(key, (map.get(key) ?? 0) + Number(row.delta_base));
  }
  const out: OnHandKey[] = [];
  for (const [key, onHand] of map) {
    if (key.startsWith("dupont:")) continue;
    const [site_id, sku_id] = key.split(":");
    if (!site_id || !sku_id) continue;
    out.push({ site_id, sku_id, onHand });
  }
  return out;
}

export function dupontOnHandFor(
  txs: { sku_id: string; site_id: string | null; location: string; delta_base: number; is_sandbox: boolean }[],
  skuId: string,
  practice: boolean,
): number {
  return txs
    .filter((row) => row.is_sandbox === practice && row.sku_id === skuId && (row.location === "dupont" || row.site_id == null))
    .reduce((sum, row) => sum + Number(row.delta_base), 0);
}
