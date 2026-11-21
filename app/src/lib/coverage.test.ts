import { describe, expect, it } from "vitest";
import { canCancelCoverage, canClaimCoverage, coverageLabel, openCoverage } from "./coverage";

const base = {
  id: "1",
  site_id: "s1",
  service_date: "2026-11-10",
  coverage_requested: true,
  requested_by: "p1",
  claimed_by: null,
  note: null,
};

describe("coverage helpers", () => {
  it("hides past open requests from the open list", () => {
    const rows = [
      { ...base, id: "past", service_date: "2026-11-01" },
      { ...base, id: "today", service_date: "2026-11-09" },
      { ...base, id: "closed", coverage_requested: false, service_date: "2026-11-12" },
    ];
    expect(openCoverage(rows, "2026-11-09").map((r) => r.id)).toEqual(["today"]);
  });

  it("labels requester vs open need and gates cancel/claim", () => {
    expect(coverageLabel(base, "p1")).toBe("Coverage requested ✓");
    expect(coverageLabel(base, "p2")).toBe("Coverage needed");
    expect(canCancelCoverage(base, "p1", false)).toBe(true);
    expect(canCancelCoverage(base, "p2", false)).toBe(false);
    expect(canCancelCoverage(base, "p2", true)).toBe(true);
    expect(canClaimCoverage(base, "p2")).toBe(true);
    expect(canClaimCoverage(base, "p1")).toBe(false);
  });
});
