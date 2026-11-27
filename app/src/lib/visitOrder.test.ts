import { describe, expect, it } from "vitest";
import { milkCleanRunning, milkStepLocks } from "./milkLock";
import { stepSatisfied, unfinishedRequired, type RequiredStep } from "./serviceFlow";

const prep: RequiredStep = { id: "prep", key: "fill_beans", title: "Fill beans", required: true };
const milk: RequiredStep = { id: "milk", key: "start_milk_clean", title: "Start milk cleaning", required: true };
const gloves: RequiredStep = { id: "gloves", key: "gloves", title: "Wash hands", required: true };
const steps = [prep, milk, gloves];

describe("checklist order is guidance", () => {
  it("lets milk be unfinished while later steps are already done", () => {
    const open = unfinishedRequired(steps, { gloves: "done", prep: "done" }, null);
    expect(open.map((step) => step.title)).toEqual(["Start milk cleaning"]);
  });

  it("lets prep be finished after milk has already started", () => {
    const started = "2026-11-06T16:00:00Z";
    expect(unfinishedRequired(steps, { gloves: "done" }, started).map((step) => step.id)).toEqual(["prep"]);
    expect(unfinishedRequired(steps, { prep: "done", gloves: "not_needed" }, started)).toEqual([]);
  });

  it("accepts tasks finished in reverse and Not needed", () => {
    expect(unfinishedRequired(steps, { gloves: "not_needed", milk: "done", prep: "done" }, null)).toEqual([]);
    expect(stepSatisfied(prep, "not_needed", null)).toBe(true);
  });

  it("still blocks Complete when a required task was never tapped", () => {
    expect(unfinishedRequired(steps, { prep: "done" }, null).map((step) => step.id)).toEqual(["milk", "gloves"]);
  });

  it("does not treat a missing timer as finished cleaning", () => {
    expect(stepSatisfied(milk, undefined, null)).toBe(false);
    expect(milkCleanRunning(null, null, 11, Date.parse("2026-11-06T16:30:00Z"))).toBe(false);
    expect(milkCleanRunning("2026-11-06T16:00:00Z", null, 11, Date.parse("2026-11-06T16:05:00Z"))).toBe(true);
    expect(milkCleanRunning("2026-11-06T16:00:00Z", "2026-11-06T16:11:00Z", 11, Date.parse("2026-11-06T16:20:00Z"))).toBe(false);
  });

  it("locks machine steps only while the timer is actually running", () => {
    const running = milkStepLocks({ key: "fill_beans", lockedDuringClean: true }, true);
    const after = milkStepLocks({ key: "fill_beans", lockedDuringClean: true }, false);
    expect(running.doneLocked).toBe(true);
    expect(after.doneLocked).toBe(false);
    expect(milkStepLocks({ key: "wipe_cameo", lockedDuringClean: true }, true).notNeededLocked).toBe(false);
  });
});
