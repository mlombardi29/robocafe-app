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
    expect(detail.shiftsTotal).toBe(53.16);
    expect(detail.tripsTotal).toBe(0);
    expect(detail.reimbursementsTotal).toBe(18.4);
    expect(detail.total).toBe(71.56);
    expect(detail.toPay).toBe(71.56);
    expect(detail.shifts[0]).not.toHaveProperty("hourlyRate");
    expect(detail.shifts[0]).not.toHaveProperty("covered");
  });

  it("keeps shift pay separate and pays a multi-site milk run once", () => {
    const detail = buildPayPeriod({
      from: "2026-11-23",
      to: "2026-11-29",
      shifts: [{ date: "2026-11-26", site: "Sinai", minutes: 90, amount: 30 }],
      trips: [
        { date: "2026-11-22", kind: "warehouse_pickup", sites: [], note: "", amount: 12 },
        { date: "2026-11-23", kind: "warehouse_pickup", sites: [], note: "Monday", amount: 12 },
        { date: "2026-11-26", kind: "warehouse_pickup", sites: [], note: "", amount: 99, voided: true },
        { date: "2026-11-27", kind: "milk_run", sites: ["Sinai", "UofT"], note: "", amount: 10 },
        { date: "2026-11-29", kind: "warehouse_pickup", sites: [], note: "Sunday", amount: 12 },
        { date: "2026-11-30", kind: "warehouse_pickup", sites: [], note: "", amount: 12 },
      ],
      reimbursements: [
        { date: "2026-11-27", note: "Milk run", amount: 6.4, held: true },
        { date: "2026-11-25", note: "Cups", amount: 4, alreadyPaid: true },
        { date: "2026-11-26", note: "Lids", amount: 3.25 },
        { date: "2026-11-22", note: "Old", amount: 9 },
      ],
    });
    expect(detail.shiftsTotal).toBe(30);
    expect(detail.trips.map((row) => row.date)).toEqual(["2026-11-23", "2026-11-27", "2026-11-29"]);
    expect(detail.trips.find((row) => row.kind === "milk_run")?.sites).toEqual(["Sinai", "UofT"]);
    expect(detail.trips.find((row) => row.kind === "milk_run")?.amount).toBe(10);
    expect(detail.tripsTotal).toBe(34);
    expect(detail.reimbursements.map((row) => row.note)).toEqual(["Cups", "Lids", "Milk run"]);
    expect(detail.reimbursementsTotal).toBe(7.25);
    expect(detail.alreadyPaidTotal).toBe(4);
    expect(detail.total).toBe(71.25);
    expect(detail.toPay).toBe(67.25);
  });

  it("lists past periods that have activity, newest first", () => {
    const past = pastPayPeriods("2026-11-21", ["2026-11-16", "2026-11-11", "2026-10-28"]);
    expect(past[0]).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(past[1]).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(past.some((period) => period.from === "2026-11-16")).toBe(false);
  });
});