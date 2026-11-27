import { describe, expect, it } from "vitest";
import { composeButtonClass, hasWhiteOnWhite, TIMER_DONE_LABEL, timerDoneButtonClass } from "./buttonStyles";

describe("timer done button", () => {
  it("keeps the label Mark cleaning done", () => {
    expect(TIMER_DONE_LABEL).toBe("Mark cleaning done");
  });

  it("uses a dark label on a white button", () => {
    const className = timerDoneButtonClass();
    expect(className).toContain("bg-white");
    expect(className).toContain("text-stone-800");
    expect(className).not.toContain("text-white");
    expect(hasWhiteOnWhite(className)).toBe(false);
  });

  it("flags the old white-on-white combination", () => {
    const old = composeButtonClass("primary", "mt-3 bg-white text-stone-900");
    expect(hasWhiteOnWhite(old)).toBe(true);
  });
});
