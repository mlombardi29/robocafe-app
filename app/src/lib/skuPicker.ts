/** Stock item picker helpers: search, recent, favourites, category browse. No invented catalogue. */

export type PickerSku = {
  id: string;
  name: string;
  base_unit?: string | null;
  category?: string | null;
  subcategory?: string | null;
};

export const FAVOURITES_KEY = "kioskops.skuFavourites";

export function readFavourites(storage: Pick<Storage, "getItem"> | null | undefined): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(FAVOURITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function writeFavourites(storage: Pick<Storage, "setItem"> | null | undefined, ids: string[]): void {
  if (!storage) return;
  storage.setItem(FAVOURITES_KEY, JSON.stringify([...new Set(ids)]));
}

export function toggleFavourite(storage: Pick<Storage, "getItem" | "setItem"> | null | undefined, skuId: string): string[] {
  const current = readFavourites(storage);
  const next = current.includes(skuId) ? current.filter((id) => id !== skuId) : [...current, skuId];
  writeFavourites(storage, next);
  return next;
}

export function recentSkuIds(txSkuIds: string[], limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = txSkuIds.length - 1; i >= 0; i -= 1) {
    const id = txSkuIds[i];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

export function matchesSearch(sku: PickerSku, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [sku.name, sku.base_unit, sku.category, sku.subcategory]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/** Distinct categories already on SKU rows. Blank/missing excluded — not invented. */
export function listCategories(skus: PickerSku[]): string[] {
  const set = new Set<string>();
  for (const sku of skus) {
    const cat = sku.category?.trim();
    if (cat) set.add(cat);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function matchesCategory(sku: PickerSku, category: string): boolean {
  if (!category) return true;
  return (sku.category?.trim() ?? "") === category;
}

export type PickerSection = { key: "favourites" | "recent" | "all"; title: string; items: PickerSku[] };

/** Favourites → recent → remaining, each filtered by search and optional category. */
export function groupPickerSkus(
  skus: PickerSku[],
  opts: { query: string; favouriteIds: string[]; recentIds: string[]; category?: string },
): PickerSection[] {
  const visible = skus.filter((sku) => matchesSearch(sku, opts.query) && matchesCategory(sku, opts.category ?? ""));
  const byId = new Map(visible.map((sku) => [sku.id, sku]));
  const used = new Set<string>();

  const favourites = opts.favouriteIds.map((id) => byId.get(id)).filter(Boolean) as PickerSku[];
  favourites.forEach((sku) => used.add(sku.id));

  const recent: PickerSku[] = [];
  for (const id of opts.recentIds) {
    const sku = byId.get(id);
    if (!sku || used.has(sku.id)) continue;
    recent.push(sku);
  }
  recent.forEach((sku) => used.add(sku.id));

  const all = visible.filter((sku) => !used.has(sku.id)).sort((a, b) => a.name.localeCompare(b.name));

  const sections: PickerSection[] = [];
  if (favourites.length) sections.push({ key: "favourites", title: "Favourites", items: favourites });
  if (recent.length) sections.push({ key: "recent", title: "Recent", items: recent });
  if (all.length) sections.push({ key: "all", title: opts.query.trim() || opts.category ? "Matches" : "All items", items: all });
  return sections;
}
