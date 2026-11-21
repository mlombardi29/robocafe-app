import { describe, expect, it } from "vitest";
import { formatDelta, placeLabel, txTypeLabel } from "./stockHistory";

describe("stockHistory", () => {
  it("labels tx types for technicians", () => {
    expect(txTypeLabel("receipt")).toBe("Add");
    expect(txTypeLabel("withdrawal")).toBe("Take");
    expect(txTypeLabel("adjustment")).toBe("Recount");
  });

  it("formats signed deltas with optional unit", () => {
    expect(formatDelta(12, "cups")).toBe("+12 cups");
    expect(formatDelta(-3, null)).toBe("-3");
  });

  it("names Dupont vs site place", () => {
    expect(placeLabel("dupont", "UofT")).toBe("Dupont");
    expect(placeLabel("site", "UofT")).toBe("UofT");
    expect(placeLabel("site", null)).toBe("Site");
  });
});
