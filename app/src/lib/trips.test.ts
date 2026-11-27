import { describe, expect, it } from "vitest";
import { instantOnTorontoDay } from "./dates";
import {
  duplicateKindMessage,
  flatTripAmount,
  sameDayKindTaken,
  tripEditAccess,
  tripSitesLabel,
  validateTripDraft,
} from "./trips";

const today = "2026-11-27";

describe("trip pay", () => {
  it("pays a multi-site milk run once and rejects a milk run with no site", () => {
    expect(flatTripAmount("milk_run", 10, 3)).toBe(10);
    expect(flatTripAmount("warehouse_pickup", 12, 0)).toBe(12);
    expect(flatTripAmount("milk_run", 10.5, 2)).toBe(10.5);
    expect(() => flatTripAmount("milk_run", 10, 0)).toThrow(/at least one site/);
    expect(tripSitesLabel(["Sinai", "UofT"])).toBe("Sinai, UofT");
  });

  it("rejects a milk run draft with no site and accepts several sites for one cost", () => {
    expect(
      validateTripDraft({
        kind: "milk_run",
        tripOn: today,
        siteIds: [],
        note: "",
        milkCost: "6.40",
        receiptAttested: true,
        today,
      }),
    ).toMatch(/at least one site/);
    expect(
      validateTripDraft({
        kind: "milk_run",
        tripOn: today,
        siteIds: ["sinai", "uoft", "sinai"],
        note: "",
        milkCost: "6.40",
        receiptAttested: true,
        today,
      }),
    ).toBeNull();
    expect(
      validateTripDraft({
        kind: "milk_run",
        tripOn: today,
        siteIds: ["sinai"],
        note: "",
        milkCost: "",
        receiptAttested: true,
        today,
      }),
    ).toMatch(/milk cost/);
    expect(
      validateTripDraft({
        kind: "milk_run",
        tripOn: today,
        siteIds: ["sinai"],
        note: "",
        milkCost: "4",
        receiptAttested: false,
        today,
      }),
    ).toMatch(/receipt/);
  });

  it("keeps warehouse pickup free of a site and refuses days before the effective date", () => {
    expect(
      validateTripDraft({
        kind: "warehouse_pickup",
        tripOn: today,
        siteIds: [],
        note: "bags",
        milkCost: "",
        receiptAttested: false,
        today,
      }),
    ).toBeNull();
    expect(
      validateTripDraft({
        kind: "warehouse_pickup",
        tripOn: today,
        siteIds: ["sinai"],
        note: "",
        milkCost: "",
        receiptAttested: false,
        today,
      }),
    ).toMatch(/does not use a site/);
    expect(
      validateTripDraft({
        kind: "warehouse_pickup",
        tripOn: "2026-11-24",
        siteIds: [],
        note: "",
        milkCost: "",
        receiptAttested: false,
        today,
      }),
    ).toMatch(/2026-11-25/);
    expect(
      validateTripDraft({
        kind: "milk_run",
        tripOn: "2026-11-28",
        siteIds: ["sinai"],
        note: "",
        milkCost: "3",
        receiptAttested: true,
        today,
      }),
    ).toMatch(/future/);
  });

  it("allows a pickup and a milk run the same day, and blocks a second of either kind", () => {
    const day = "2026-11-27";
    const rows: { kind: "warehouse_pickup" | "milk_run"; date: string; voided?: boolean }[] = [
      { kind: "warehouse_pickup", date: day },
    ];
    expect(sameDayKindTaken(rows, "milk_run", day)).toBe(false);
    expect(sameDayKindTaken(rows, "warehouse_pickup", day)).toBe(true);
    rows.push({ kind: "milk_run", date: day });
    expect(sameDayKindTaken(rows, "milk_run", day)).toBe(true);
    expect(sameDayKindTaken(rows, "warehouse_pickup", "2026-11-26")).toBe(false);
    rows[0] = { ...rows[0], voided: true };
    expect(sameDayKindTaken(rows, "warehouse_pickup", day)).toBe(false);
    expect(duplicateKindMessage("milk_run")).toMatch(/milk run/);
    expect(duplicateKindMessage("warehouse_pickup")).toMatch(/warehouse pickup/);
  });

  it("uses the charge same-day window and locks a paid or voided trip", () => {
    const created = instantOnTorontoDay("2026-11-27", "09:00");
    const base = { person_id: "tech", voided: false, created_at: created, paymentStatus: null };
    expect(
      tripEditAccess({
        trip: base,
        viewerPersonId: "tech",
        isAdmin: false,
        now: new Date(instantOnTorontoDay("2026-11-27", "18:00")),
      }).canEdit,
    ).toBe(true);
    expect(
      tripEditAccess({
        trip: base,
        viewerPersonId: "tech",
        isAdmin: false,
        now: new Date(instantOnTorontoDay("2026-11-28", "00:05")),
      }).reason,
    ).toBe("locked");
    expect(
      tripEditAccess({
        trip: base,
        viewerPersonId: "other",
        isAdmin: false,
        now: new Date(instantOnTorontoDay("2026-11-27", "12:00")),
      }).reason,
    ).toBe("not-owner");
    expect(tripEditAccess({ trip: { ...base, voided: true }, viewerPersonId: "admin", isAdmin: true }).reason).toBe("voided");
    expect(
      tripEditAccess({ trip: { ...base, paymentStatus: "paid" }, viewerPersonId: "admin", isAdmin: true }).reason,
    ).toBe("paid");
    expect(
      tripEditAccess({
        trip: base,
        viewerPersonId: "admin",
        isAdmin: true,
        now: new Date(instantOnTorontoDay("2026-12-01", "12:00")),
      }).canEdit,
    ).toBe(true);
  });
});
