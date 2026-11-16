import { describe, expect, it } from "vitest";
import {
  formatPlanDay,
  isServiceDay,
  nextServiceShifts,
  outstandingVisits,
  upcomingServiceDays,
  type PlanSite,
  type TodaySiteState,
} from "./homePlan";

const sinai: PlanSite = { id: "sinai", shortName: "Sinai", name: "Mount Sinai Hospital", cadence: "daily", active: true };
const uoft: PlanSite = { id: "uoft", shortName: "UofT", name: "UofT Sidney Smith", cadence: "mwf", active: true };
const rbc: PlanSite = { id: "rbc", shortName: "RBC", name: "RBC", cadence: "show_days", active: true };

function state(partial: Partial<TodaySiteState> & Pick<TodaySiteState, "siteId">): TodaySiteState {
  return { due: false, completed: false, inProgress: false, paused: false, label: "Due today", ...partial };
}

describe("home plan", () => {
  it("treats daily, Mon/Wed/Fri, and scheduled shows as service days", () => {
    expect(isServiceDay("daily", 2, false)).toBe(true);
    expect(isServiceDay("mwf", 1, false)).toBe(true);
    expect(isServiceDay("mwf", 2, false)).toBe(false);
    expect(isServiceDay("show_days", 1, false)).toBe(false);
    expect(isServiceDay("show_days", 1, true)).toBe(true);
  });

  it("puts today's outstanding visits first, one or both", () => {
    const one = outstandingVisits([sinai, uoft], [state({ siteId: "sinai", due: true }), state({ siteId: "uoft", due: false })]);
    expect(one.map((row) => row.shortName)).toEqual(["Sinai"]);
    expect(one[0]?.action).toBe("Start visit");

    const both = outstandingVisits(
      [sinai, uoft],
      [state({ siteId: "sinai", due: true }), state({ siteId: "uoft", due: true, inProgress: true, label: "Resume this visit." })],
    );
    expect(both.map((row) => [row.shortName, row.action])).toEqual([
      ["Sinai", "Start visit"],
      ["UofT", "Continue visit"],
    ]);
  });

  it("hides a visit that is already done or not a service day", () => {
    const rows = outstandingVisits(
      [sinai, uoft],
      [state({ siteId: "sinai", due: false, completed: true }), state({ siteId: "uoft", due: false, label: "Not a service day" })],
    );
    expect(rows).toEqual([]);
  });

  it("shows the next shift when nothing is scheduled today", () => {
    const next = nextServiceShifts([uoft], "2026-11-17", []);
    expect(next.map((row) => row.date)).toEqual(["2026-11-18"]);
    expect(next[0]?.shortName).toBe("UofT");
    expect(formatPlanDay("2026-11-18")).toMatch(/Nov 18/);
  });

  it("groups both sites when the next day has two stops", () => {
    const next = nextServiceShifts([sinai, uoft], "2026-11-17", []);
    expect(next.map((row) => row.shortName)).toEqual(["Sinai", "UofT"]);
  });

  it("lists a show only on its scheduled day", () => {
    const rows = upcomingServiceDays([rbc], "2026-11-16", [{ siteId: "rbc", date: "2026-11-18", status: "scheduled" }], 4);
    expect(rows.map((row) => row.date)).toEqual(["2026-11-18"]);
  });
});