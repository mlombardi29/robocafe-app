import { describe, expect, it } from "vitest";
import { money, normalizeReceiptUrl, parseChargeAmount, unpaidCharges } from "./charges";

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
    ];
    expect(unpaidCharges(rows).map((r) => r.id)).toEqual(["b"]);
    expect(money(4)).toBe("$4.00");
  });
});
