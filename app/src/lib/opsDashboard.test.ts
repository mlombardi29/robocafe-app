import { describe, expect, it } from "vitest";
import { countBelowReorder, countOpenFlags, opsBoardCounts, suggestedPickupQty } from "./opsDashboard";

describe("ops dashboard", () => {
  it("counts out flags and open service flags", () => {
    const flags = [
      { status: "out" as const, site_id: "s1", resolved_at: null },
      { status: "low" as const, site_id: "s1", resolved_at: null },
      { status: "out" as const, site_id: "s2", resolved_at: "2026-11-01" },
    ];
    expect(countOpenFlags(flags)).toEqual({ out: 1, serviceFlags: 2 });
    expect(countOpenFlags(flags, ["s2"])).toEqual({ out: 0, serviceFlags: 0 });
  });

  it("counts below-reorder only when a threshold is set", () => {
    const levels = [
      { site_id: "s1", sku_id: "a", low_threshold: 10 },
      { site_id: "s1", sku_id: "b", low_threshold: null },
    ];
    const onHand = [
      { site_id: "s1", sku_id: "a", onHand: 4 },
      { site_id: "s1", sku_id: "b", onHand: 0 },
    ];
    expect(countBelowReorder(levels, onHand)).toBe(1);
  });

  it("builds the four board counts and suggests pickup shortfall", () => {
    const board = opsBoardCounts({
      flags: [{ status: "out", site_id: "s1", resolved_at: null }],
      levels: [{ site_id: "s1", sku_id: "a", low_threshold: 5 }],
      onHand: [{ site_id: "s1", sku_id: "a", onHand: 1 }],
      coverage: [
        {
          id: "c1",
          site_id: "s1",
          service_date: "2026-11-10",
          coverage_requested: true,
          requested_by: "p",
          claimed_by: null,
          note: null,
        },
      ],
      today: "2026-11-09",
    });
    expect(board).toEqual({ out: 1, toReorder: 1, serviceFlags: 1, coverageNeeded: 1 });
    expect(suggestedPickupQty({ siteOnHand: 2, target: 10, dupontOnHand: 5 })).toBe(5);
    expect(suggestedPickupQty({ siteOnHand: 2, target: null, dupontOnHand: 5 })).toBeNull();
  });
});
