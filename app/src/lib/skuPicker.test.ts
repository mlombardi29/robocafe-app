import { describe, expect, it } from "vitest";
import { groupPickerSkus, listCategories, matchesSearch, recentSkuIds, toggleFavourite } from "./skuPicker";

const skus = [
  { id: "a", name: "12 oz Hot Cups", category: "cups" },
  { id: "b", name: "Vanilla Syrup", category: "syrup" },
  { id: "c", name: "Coffee Concentrate", category: "coffee" },
  { id: "d", name: "No category yet", category: null },
];

describe("sku picker", () => {
  it("filters by search across name and category", () => {
    expect(matchesSearch(skus[0]!, "hot")).toBe(true);
    expect(matchesSearch(skus[1]!, "syrup")).toBe(true);
    expect(matchesSearch(skus[2]!, "lid")).toBe(false);
  });

  it("lists only categories already on SKUs and filters by them", () => {
    expect(listCategories(skus)).toEqual(["coffee", "cups", "syrup"]);
    const sections = groupPickerSkus(skus, { query: "", favouriteIds: [], recentIds: [], category: "cups" });
    expect(sections.map((s) => s.key)).toEqual(["all"]);
    expect(sections[0]!.items.map((s) => s.id)).toEqual(["a"]);
  });

  it("orders favourites then recent then the rest without duplicates", () => {
    const sections = groupPickerSkus(skus, {
      query: "",
      favouriteIds: ["b"],
      recentIds: ["b", "c", "a"],
    });
    expect(sections.map((s) => s.key)).toEqual(["favourites", "recent", "all"]);
    expect(sections[0]!.items.map((s) => s.id)).toEqual(["b"]);
    expect(sections[1]!.items.map((s) => s.id)).toEqual(["c", "a"]);
  });

  it("builds recent ids newest-first and toggles favourites in storage", () => {
    expect(recentSkuIds(["a", "b", "a", "c"], 2)).toEqual(["c", "a"]);
    const store: Record<string, string> = {};
    const storage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    };
    expect(toggleFavourite(storage, "a")).toEqual(["a"]);
    expect(toggleFavourite(storage, "b")).toEqual(["a", "b"]);
    expect(toggleFavourite(storage, "a")).toEqual(["b"]);
  });
});
