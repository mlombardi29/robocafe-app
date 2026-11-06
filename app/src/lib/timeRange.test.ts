import { describe, expect, it } from "vitest";
import { durationLabel, durationMinutes, inRange, rangeBounds } from "./timeRange";

describe("My Time ranges", () => {
  it("uses Monday as the start of the week containing Nov 5 2026", () => {
    expect(rangeBounds("this-week", "2026-11-05")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(rangeBounds("past-week", "2026-11-05")).toEqual({ from: "2026-10-26", to: "2026-11-01" });
  });

  it("covers this month, last month, and last calendar year", () => {
    expect(rangeBounds("this-month", "2026-11-05").from).toBe("2026-11-01");
    expect(rangeBounds("past-month", "2026-11-05")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(rangeBounds("past-year", "2026-11-05")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("formats a 22 minute visit", () => {
    expect(durationMinutes("2026-11-05T23:00:00Z", "2026-11-05T23:22:00Z")).toBe(22);
    expect(durationLabel(22)).toBe("22 min");
    expect(inRange("2026-11-05", "2026-11-02", "2026-11-08")).toBe(true);
  });
});
