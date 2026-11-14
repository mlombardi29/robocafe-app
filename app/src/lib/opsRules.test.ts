import { describe, expect, it } from "vitest";
import { dupontGuidance, fitWithin, kcInstruction, kcLines, photoAuditRequired, photoAuditRequiredBySnapshot, shotsForLabels } from "./opsRules";

describe("ops batch rules", () => {
  it("asks for seven shots until three visits at that kiosk are reviewed ok", () => {
    const shots = shotsForLabels(["Overall", "Cleaning", "Beans", "Powders", "Cups", "Closed", "Spouts"]);
    expect(shots).toHaveLength(7);
    expect(shots[1]?.key).toBe("cleaning");
    expect(photoAuditRequired(0)).toBe(true);
    expect(photoAuditRequired(2)).toBe(true);
    expect(photoAuditRequired(3)).toBe(false);
    expect(photoAuditRequiredBySnapshot(null)).toBe(false);
    expect(photoAuditRequiredBySnapshot({})).toBe(false);
    expect(photoAuditRequiredBySnapshot({ photo_audit: { required: false } })).toBe(false);
    expect(photoAuditRequiredBySnapshot({ photo_audit: { required: true } })).toBe(true);
  });

  it("shrinks the long edge to 1600 pixels", () => {
    expect(fitWithin(3200, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("stops at Dupont for a Dupont flag or a saved shortfall, and otherwise goes direct", () => {
    expect(dupontGuidance({
      openFlags: [{ skuId: "milk", source: "grocery", status: "out" }],
      levels: [],
    }).stop).toBe(false);
    expect(dupontGuidance({
      openFlags: [{ skuId: "cups", source: "dupont", status: "low" }],
      levels: [],
    }).detail).toMatch(/Stop at Dupont first/);
    expect(dupontGuidance({
      openFlags: [],
      levels: [{ skuId: "cups", source: "dupont", onHand: 2, target: 10 }],
    }).stop).toBe(true);
    expect(dupontGuidance({
      openFlags: [],
      levels: [{ skuId: "cups", source: "dupont", onHand: 2, target: null }],
    }).stop).toBe(false);
  });

  it("builds a KC line only when the step was done and a max is saved", () => {
    const settings = [
      { skuId: "cups", name: "Cups", unit: "cups", kcMax: 250 },
      { skuId: "lids", name: "Lids", unit: null, kcMax: null },
    ];
    expect(kcLines(["lids"], settings)).toEqual([]);
    expect(kcLines(["cups"], settings)).toHaveLength(1);
    expect(kcInstruction(settings[0], true, null)).toBe("Tap To Container Max Size in KC Manager (250 cups).");
    expect(kcInstruction(settings[0], false, 40)).toBe("Type 40 cups into Consumable Quantity in KC Manager.");
  });
});
