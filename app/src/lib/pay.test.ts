import { describe, expect, it } from "vitest";
import {
  COVERAGE_PAY_RULE,
  isCoveredShift,
  lineAmount,
  money,
  payPersonForShift,
  rateForDay,
  ratesForShiftPay,
} from "./pay";
import { payPdf } from "./payPdf";

describe("pay", () => {
  const rates = [
    { effectiveOn: "2026-01-01", hourlyRate: 20 },
    { effectiveOn: "2026-11-01", hourlyRate: 22 },
  ];
  const other = [{ effectiveOn: "2026-01-01", hourlyRate: 40 }];

  it("uses the rate in force on the shift date", () => {
    expect(rateForDay(rates, "2026-10-31")).toBe(20);
    expect(rateForDay(rates, "2026-11-01")).toBe(22);
    expect(rateForDay(rates, "2026-12-01")).toBe(22);
    expect(rateForDay([], "2026-11-01")).toBeNull();
  });

  it("pays covered shifts to the worker at the worker's own rate", () => {
    expect(COVERAGE_PAY_RULE).toBe("worker_own_hourly_rate");
    expect(payPersonForShift("coverer", "original")).toBe("coverer");
    expect(ratesForShiftPay(rates, other)).toEqual(rates);
    expect(rateForDay(ratesForShiftPay(rates, other), "2026-11-01")).toBe(22);
    expect(
      isCoveredShift(
        [{ site_id: "s1", service_date: "2026-11-08", claimed_by: "coverer" }],
        "s1",
        "2026-11-08",
        "coverer",
      ),
    ).toBe(true);
    expect(
      isCoveredShift(
        [{ site_id: "s1", service_date: "2026-11-08", claimed_by: "coverer" }],
        "s1",
        "2026-11-08",
        "original",
      ),
    ).toBe(false);
  });

  it("rounds a shift to the cent", () => {
    expect(lineAmount(21, 20)).toBe(7);
    expect(lineAmount(90, 22)).toBe(33);
    expect(money(33)).toBe("$33.00");
  });

  it("puts the paid total in the PDF as text", () => {
    const text = payPdf({
      person: "Kajsa",
      periodStart: "2026-10-26",
      periodEnd: "2026-11-01",
      paidOn: "2026-11-06",
      lines: [{ day: "Thu Nov 5", when: "6:02-6:23 pm", minutes: 21, amount: 7.7 }],
      total: 7.7,
    });
    expect(text).toContain("Pay for Kajsa");
    expect(text).toContain("Paid on 2026-11-06");
    expect(text).toContain("Total $7.70");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
  });
});