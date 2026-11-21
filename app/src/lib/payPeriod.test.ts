import { describe, expect, it } from "vitest";
import { buildPayPeriod, currentPayPeriod, pastPayPeriods, previousPayPeriod } from "./payPeriod";
import { rangeBounds } from "./timeRange";

describe("pay periods", () => {
  it("uses the same Monday–Sunday window as payroll", () => {
    expect(currentPayPeriod("2026-11-21")).toEqual(rangeBounds("this-week", "2026-11-21"));
    expect(currentPayPeriod("2026-11-21")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(previousPayPeriod(currentPayPeriod("2026-11-21"))).toEqual({ from: "2026-11-09", to: "2026-11-15" });
  });

  it("groups a period's shifts and reimbursements and totals them", () => {
    const detail = buildPayPeriod({
      from: "2026-11-16",
      to: "2026-11-22",
      shifts: [
        { date: "2026-11-18", site: "UofT", minutes: 80, amount: 29.33 },
        { date: "2026-11-16", site: "Sinai", minutes: 65, amount: 23.83 },
        { date: "2026-11-09", site: "Sinai", minutes: 60, amount: 22 },
      ],
      reimbursements: [
        { date: "2026-11-16", note: "Oat milk", amount: 18.4 },
        { date: "2026-11-10", note: "Cups", amount: 12.5 },
      ],
    });
    expect(detail.shifts.map((row) => row.site)).toEqual(["Sinai", "UofT"]);
    expect(detail.reimbursements.map((row) => row.note)).toEqual(["Oat milk"]);
    expect(detail.total).toBe(71.56);
    expect(detail.shifts[0]).not.toHaveProperty("hourlyRate");
    expect(detail.shifts[0]).not.toHaveProperty("covered");
  });

  it("lists past periods that have activity, newest first", () => {
    const past = pastPayPeriods("2026-11-21", ["2026-11-16", "2026-11-11", "2026-10-28"]);
    expect(past[0]).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(past[1]).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(past.some((period) => period.from === "2026-11-16")).toBe(false);
  });
});