import { describe, expect, it } from "vitest";
import { correctionGlance, glanceDelta, glanceDuration, glanceText } from "./correctionGlance";

describe("correction glance", () => {
  const start = "2026-11-05T23:02:00.000Z";
  const end = "2026-11-05T23:23:00.000Z";
  const wantedEnd = "2026-11-06T00:02:00.000Z";

  it("says 21 min charged, 1 hr wanted, and +39 min", () => {
    const glance = correctionGlance({
      serviceDate: "2026-11-05",
      startAt: start,
      endAt: end,
      requestedStart: null,
      requestedEnd: wantedEnd,
    });
    expect(glance.currentDay).toBe("Thu Nov 5");
    expect(glance.currentRange).toBe("6:02–6:23 pm");
    expect(glance.currentDuration).toBe("21 min");
    expect(glance.wantedRange).toBe("6:02–7:02 pm");
    expect(glance.wantedDuration).toBe("1 hr");
    expect(glance.delta).toBe("+39 min");
    expect(glance.timesChanged).toBe(true);
    expect(glanceText(glance)).not.toMatch(/T\d{2}:\d{2}|\+00:00|Z/);
  });

  it("uses a minus sign when they want a shorter visit", () => {
    expect(glanceDuration(60)).toBe("1 hr");
    expect(glanceDuration(90)).toBe("1 hr 30 min");
    expect(glanceDelta(70, 60)).toBe("−10 min");
    expect(glanceDelta(21, 21)).toBe("Same length");
  });

  it("keeps the charged times when no new clock time was asked for", () => {
    const glance = correctionGlance({
      serviceDate: "2026-11-05",
      startAt: start,
      endAt: end,
      requestedStart: null,
      requestedEnd: null,
    });
    expect(glance.timesChanged).toBe(false);
    expect(glance.wantedRange).toBe("6:02–6:23 pm");
    expect(glance.delta).toBe("Same length");
  });
});
