import { describe, expect, it } from "vitest";
import { formatTorontoTime } from "./dates";
import { addDays, evaluateDue, previousMwf, thresholdDetail, visitStatus, type DueItem } from "./due";

const today = "2026-11-09";

function item(partial: Partial<DueItem> & Pick<DueItem, "key" | "cadenceType">): DueItem {
  return {
    cadenceDays: null,
    status: "active",
    thresholdValue: null,
    thresholdUnit: null,
    ...partial,
  };
}

describe("evaluateDue", () => {
  it("shows every visit", () => {
    const result = evaluateDue(item({ key: "gloves", cadenceType: "every_visit" }), null, today);
    expect(result.show).toBe(true);
    expect(result.due).toBe(true);
  });

  it("keeps a recent every-n-days step visible and says when it is due", () => {
    const step = item({ key: "filters", cadenceType: "every_n_days", cadenceDays: 4 });
    const recent = evaluateDue(step, "2026-11-08", today);
    expect(recent.show).toBe(true);
    expect(recent.due).toBe(false);
    expect(recent.detail).toBe("Early. Day 2 of 4 — due in 3 days");
    expect(evaluateDue(step, null, today).show).toBe(true);
    expect(evaluateDue(step, "2026-11-05", today).due).toBe(true);
  });

  it("treats weekly, biweekly, and monthly as 7, 14, and 30 days and still shows them early", () => {
    const early = evaluateDue(item({ key: "arm_calibration", cadenceType: "weekly" }), "2026-11-03", today);
    expect(early.show).toBe(true);
    expect(early.due).toBe(false);
    expect(early.detail).toContain("needed every 7 days");
    expect(evaluateDue(item({ key: "arm_calibration", cadenceType: "weekly" }), "2026-11-02", today).due).toBe(true);
    expect(evaluateDue(item({ key: "deep_clean_nozzles", cadenceType: "biweekly" }), "2026-10-27", today).due).toBe(false);
    expect(evaluateDue(item({ key: "deep_clean_nozzles", cadenceType: "biweekly" }), "2026-10-26", today).due).toBe(true);
    expect(evaluateDue(item({ key: "deep_clean_fridges", cadenceType: "monthly" }), "2026-10-11", today).due).toBe(false);
    expect(evaluateDue(item({ key: "deep_clean_fridges", cadenceType: "monthly" }), "2026-10-10", today).due).toBe(true);
  });

  it("shows a threshold step with X, or a blank placeholder", () => {
    const blank = evaluateDue(item({ key: "cups_lids", cadenceType: "below_threshold" }), "2026-11-09", today);
    expect(blank.detail).toBe("Check. Fill if low.");
    const set = evaluateDue(
      item({ key: "cups_lids", cadenceType: "below_threshold", thresholdValue: 250, thresholdUnit: "cups" }),
      null,
      today,
    );
    expect(set.detail).toBe("Check. Fill only if below 250 cups.");
    expect(set.show).toBe(true);
    expect(thresholdDetail(50, "% full")).toBe("Check. Fill only if below half.");
    expect(thresholdDetail(67, "% full")).toBe("Check. Fill only if below two-thirds.");
    expect(thresholdDetail(3, "days of stock")).toBe("Check. Fill only if below 3 days of stock.");
    expect(thresholdDetail(null, "Fill cups and lids to the top every visit")).toBe("Check. Fill cups and lids to the top every visit");
  });

  it("shows check-and-decide steps", () => {
    const result = evaluateDue(item({ key: "garbage", cadenceType: "check_decide" }), "2026-11-09", today);
    expect(result.show).toBe(true);
    expect(result.detail).toBe("Check and decide.");
  });

  it("shows the milk bag every visit and marks it due at 4 days", () => {
    const step = item({ key: "milk_bag", cadenceType: "every_n_days", cadenceDays: 4 });
    const fresh = evaluateDue(step, "2026-11-07", today);
    expect(fresh.show).toBe(true);
    expect(fresh.due).toBe(false);
    expect(fresh.detail).toBe("Early. Day 3 of 4 — due in 2 days");
    const tomorrow = evaluateDue(step, "2026-11-06", today);
    expect(tomorrow.detail).toBe("Early. Day 4 of 4 — due tomorrow");
    const old = evaluateDue(step, "2026-11-04", today);
    expect(old.due).toBe(true);
    expect(old.overdue).toBe(true);
    expect(old.detail).toContain("Overdue");
    expect(evaluateDue(step, null, today).detail).toBe("Not recorded yet · needed every 4 days");
  });

  it("shows the puck bin and highlights overdue at 2 days", () => {
    const step = item({ key: "empty_pucks", cadenceType: "check_decide" });
    expect(evaluateDue(step, "2026-11-08", today).overdue).toBe(false);
    const overdue = evaluateDue(step, "2026-11-06", today);
    expect(overdue.show).toBe(true);
    expect(overdue.overdue).toBe(true);
    expect(evaluateDue(step, null, today).overdue).toBe(true);
  });

  it("shows the arm sensor placeholder only as a note, with no invented pass rule", () => {
    const result = evaluateDue(
      item({ key: "arm_sensor", cadenceType: "weekly", status: "pending_validation" }),
      "2026-11-01",
      today,
    );
    expect(result.show).toBe(true);
    expect(result.placeholder).toContain("Albert Kim");
    expect(result.placeholder).not.toMatch(/solid green|laser/i);
  });
});

describe("visitStatus", () => {
  const base = {
    openingTime: null,
    active: true,
    weekday: 1,
    nowMinutes: 9 * 60,
    showStartMinutes: null,
    showStatus: null,
    startedToday: false,
    completedDates: [] as string[],
    previousServiceDate: "2026-11-08",
  };

  it("flags a missed daily visit and still shows today as due", () => {
    const status = visitStatus({ ...base, cadence: "daily", weekday: 1 });
    expect(status.due).toBe(true);
    expect(status.missed).toBe(true);
  });

  it("does not raise the UofT Monday flag when opening time is blank", () => {
    const status = visitStatus({ ...base, cadence: "mwf", weekday: 1, openingTime: null, previousServiceDate: "2026-11-06", completedDates: ["2026-11-06"] });
    expect(status.due).toBe(true);
    expect(status.beforeOpening).toBe(false);
    expect(status.label).toBe("Due today");
  });

  it("raises the Monday flag only after a known opening time", () => {
    const late = visitStatus({
      ...base,
      cadence: "mwf",
      weekday: 1,
      openingTime: "08:00",
      nowMinutes: 9 * 60,
      previousServiceDate: "2026-11-06",
      completedDates: ["2026-11-06"],
    });
    expect(late.beforeOpening).toBe(true);
    const early = visitStatus({
      ...base,
      cadence: "mwf",
      weekday: 1,
      openingTime: "08:00",
      nowMinutes: 7 * 60,
      previousServiceDate: "2026-11-06",
      completedDates: ["2026-11-06"],
    });
    expect(early.beforeOpening).toBe(false);
    const started = visitStatus({
      ...base,
      cadence: "mwf",
      weekday: 1,
      openingTime: "08:00",
      nowMinutes: 9 * 60,
      previousServiceDate: "2026-11-06",
      completedDates: ["2026-11-06"],
      startedToday: true,
    });
    expect(started.beforeOpening).toBe(false);
  });

  it("limits UofT to Monday, Wednesday, and Friday", () => {
    expect(visitStatus({ ...base, cadence: "mwf", weekday: 2 }).due).toBe(false);
    expect(visitStatus({ ...base, cadence: "mwf", weekday: 3, previousServiceDate: "2026-11-02", completedDates: ["2026-11-02"] }).due).toBe(true);
  });

  it("shows RBC only on a scheduled show day", () => {
    expect(visitStatus({ ...base, cadence: "show_days" }).label).toBe("No show today");
    const show = visitStatus({
      ...base,
      cadence: "show_days",
      showStatus: "scheduled",
      showStartMinutes: 18 * 60,
      nowMinutes: 16 * 60,
    });
    expect(show.due).toBe(true);
    expect(show.lateForShow).toBe(false);
    const late = visitStatus({
      ...base,
      cadence: "show_days",
      showStatus: "scheduled",
      showStartMinutes: 18 * 60,
      nowMinutes: 18 * 60 + 5,
      startedToday: false,
      previousServiceDate: null,
    });
    expect(late.lateForShow).toBe(true);
  });

  it("replaces Due today after a visit was completed today", () => {
    const status = visitStatus({
      ...base,
      cadence: "daily",
      weekday: 4,
      completedTodayTime: "6:20 PM",
    });
    expect(status.due).toBe(false);
    expect(status.label).toBe("Completed today 6:20 PM");
  });

  it("keeps an inactive site off the due list", () => {
    expect(visitStatus({ ...base, cadence: "show_days", active: false }).label).toBe("Offline for the season");
    expect(visitStatus({ ...base, cadence: "daily", pausedTime: "6:23 PM" }).label).toContain("Paused · clocked out 6:23 PM");
    expect(visitStatus({ ...base, cadence: "daily", visitInProgress: true }).label).toBe("Visit in progress");
    expect(visitStatus({ ...base, cadence: "daily", incompleteToday: true }).label).toBe("Incomplete today");
  });
});

describe("Toronto clock", () => {
  it("formats 23:23Z in November as 6:23 PM", () => {
    expect(formatTorontoTime("2026-11-05T23:23:38Z")).toBe("6:23 PM");
  });
});

describe("date helpers", () => {
  it("walks back to the previous Mon/Wed/Fri", () => {
    expect(previousMwf("2026-11-09")).toBe("2026-11-06");
    expect(addDays("2026-11-09", -1)).toBe("2026-11-08");
  });
});
