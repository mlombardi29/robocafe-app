import { describe, expect, it } from "vitest";
import { SYNTHETIC_CATALOGUE, previewCatalogue } from "./cataloguePreview";

describe("catalogue preview", () => {
  const preview = previewCatalogue(SYNTHETIC_CATALOGUE);

  it("proposes cup and lid conversions without writing or inventing a KC max", () => {
    expect(preview.writes).toBe(0);
    const cups = preview.proposals.find((row) => row.legacyId === "sample-cups");
    expect(cups?.proposedBaseUnit).toBe("cup");
    expect(cups?.conversionFactor).toBe(50);
    expect(cups?.derivedRaw).toBe(34);
    expect(cups?.derivedProposed).toBe(1700);
    expect(cups?.kcMax).toBeNull();
    expect(cups?.siteLinksProposed).toEqual([]);
    const lids = preview.proposals.find((row) => row.legacyId === "sample-lids");
    expect(lids?.conversionFactor).toBe(100);
    expect(lids?.derivedProposed).toBe(2100);
  });

  it("surfaces negative and fractional stock instead of clamping it", () => {
    const concentrate = preview.proposals.find((row) => row.legacyId === "sample-concentrate");
    expect(concentrate?.derivedRaw).toBe(-0.004);
    expect(concentrate?.issues.some((issue) => issue.code === "negative_derived_stock")).toBe(true);
    const disposable = preview.proposals.find((row) => row.legacyId === "sample-disposable");
    expect(disposable?.derivedRaw).toBe(4.5);
    expect(disposable?.derivedProposed).toBeNull();
    expect(disposable?.issues.some((issue) => issue.code === "fractional_stock")).toBe(true);
    expect(preview.proposals.find((row) => row.legacyId === "sample-spice")?.derivedRaw).toBe(-4);
  });

  it("does not guess reorder or stock when a row has the wrong number of fields", () => {
    expect(preview.proposals.some((row) => row.legacyId === "sample-spice-short")).toBe(false);
    expect(preview.issues.some((issue) => issue.code === "ambiguous_columns" && issue.legacyId === "sample-spice-short")).toBe(true);
  });
});
