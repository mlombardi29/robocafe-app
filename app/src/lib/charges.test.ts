import { describe, expect, it } from "vitest";
import {
  chargeEditAccess,
  chargeEditLockedLabel,
  chargeSameTorontoDay,
  money,
  normalizeReceiptUrl,
  parseChargeAmount,
  unpaidCharges,
} from "./charges";
import { instantOnTorontoDay } from "./dates";

describe("charges helpers", () => {
  it("parses positive amounts and optional receipt links", () => {
    expect(parseChargeAmount("12.50")).toBe(12.5);
    expect(parseChargeAmount("0")).toBeNull();
    expect(parseChargeAmount("-3")).toBeNull();
    expect(normalizeReceiptUrl("  ")).toBeNull();
    expect(normalizeReceiptUrl(" https://example/receipt ")).toBe("https://example/receipt");
  });

  it("lists unpaid charges and formats money", () => {
    const rows = [
      { id: "a", person_id: "p", site_id: null, amount: 10, note: null, receipt_url: null, paid: true, created_at: "2026-11-01" },
      { id: "b", person_id: "p", site_id: null, amount: 4, note: "milk", receipt_url: null, paid: false, created_at: "2026-11-08" },
      { id: "c", person_id: "p", site_id: null, amount: 2, note: null, receipt_url: null, paid: false, voided: true, created_at: "2026-11-08" },
    ];
    expect(unpaidCharges(rows).map((r) => r.id)).toEqual(["b"]);
    expect(money(4)).toBe("$4.00");
  });

  it("treats the tech edit window as the Toronto calendar day of created_at", () => {
    const created = instantOnTorontoDay("2026-11-15", "14:30");
    const sameEvening = new Date(instantOnTorontoDay("2026-11-15", "23:59"));
    const nextMorning = new Date(instantOnTorontoDay("2026-11-16", "00:01"));
    expect(chargeSameTorontoDay(created, sameEvening)).toBe(true);
    expect(chargeSameTorontoDay(created, nextMorning)).toBe(false);
  });

  it("lets a tech edit own unpaid charge only the same Toronto day", () => {
    const created = instantOnTorontoDay("2026-11-15", "10:00");
    const base = { person_id: "tech", paid: false, voided: false, created_at: created };
    expect(
      chargeEditAccess({
        charge: base,
        viewerPersonId: "tech",
        isAdmin: false,
        now: new Date(instantOnTorontoDay("2026-11-15", "22:00")),
      }).canEdit,
    ).toBe(true);
    expect(
      chargeEditAccess({
        charge: base,
        viewerPersonId: "tech",
        isAdmin: false,
        now: new Date(instantOnTorontoDay("2026-11-16", "00:05")),
      }),
    ).toEqual({ canEdit: false, reason: "locked" });
    expect(chargeEditLockedLabel("locked")).toBe("Ask an admin to change this");
  });

  it("blocks tech edits of paid or others' charges; admin may edit unpaid or paid non-voided", () => {
    const created = instantOnTorontoDay("2026-11-15", "10:00");
    const now = new Date(instantOnTorontoDay("2026-11-15", "12:00"));
    expect(
      chargeEditAccess({
        charge: { person_id: "tech", paid: true, voided: false, created_at: created },
        viewerPersonId: "tech",
        isAdmin: false,
        now,
      }).reason,
    ).toBe("paid");
    expect(
      chargeEditAccess({
        charge: { person_id: "tech", paid: false, voided: false, created_at: created },
        viewerPersonId: "other",
        isAdmin: false,
        now,
      }).reason,
    ).toBe("not-owner");
    expect(
      chargeEditAccess({
        charge: { person_id: "tech", paid: true, voided: false, created_at: created },
        viewerPersonId: "admin",
        isAdmin: true,
        now: new Date(instantOnTorontoDay("2026-11-20", "12:00")),
      }).canEdit,
    ).toBe(true);
    expect(
      chargeEditAccess({
        charge: { person_id: "tech", paid: false, voided: true, created_at: created },
        viewerPersonId: "admin",
        isAdmin: true,
        now,
      }).reason,
    ).toBe("voided");
  });
});
