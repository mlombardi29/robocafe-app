import { describe, expect, it } from "vitest";
import {
  endNotice,
  outcomeFromEndUpdate,
  queueAfterFailure,
  stepSatisfied,
  unfinishedRequired,
  type RequiredStep,
} from "./serviceFlow";

const milk: RequiredStep = { id: "milk", key: "start_milk_clean", title: "Start milk module cleaning", required: true };
const gloves: RequiredStep = { id: "gloves", key: "gloves", title: "Wash hands, put on gloves", required: true };
const drink: RequiredStep = { id: "drink", key: "test_drink", title: "Test drink", required: true };

describe("complete service gate", () => {
  it("lists every unfinished required step, not a truncated sentence", () => {
    const open = unfinishedRequired([milk, gloves, drink], {}, null);
    expect(open.map((step) => step.title)).toEqual([
      "Start milk module cleaning",
      "Wash hands, put on gloves",
      "Test drink",
    ]);
  });

  it("treats Done and Not needed as finished", () => {
    expect(stepSatisfied(gloves, "done", null)).toBe(true);
    expect(stepSatisfied(gloves, "not_needed", null)).toBe(true);
    expect(unfinishedRequired([gloves], { gloves: "not_needed" }, null)).toEqual([]);
  });

  it("counts a milk timer that already started as Done on every model key", () => {
    expect(stepSatisfied(milk, undefined, "2026-11-09T15:00:00Z")).toBe(true);
    expect(unfinishedRequired([milk, drink], { drink: "done" }, "2026-11-09T15:00:00Z")).toEqual([]);
  });

  it("still blocks milk cleaning when the timer never started", () => {
    expect(unfinishedRequired([milk], {}, null).map((step) => step.id)).toEqual(["milk"]);
  });

  it("lets Not needed clear the milk step without a timer", () => {
    expect(stepSatisfied(milk, "not_needed", null)).toBe(true);
  });
});

describe("end now result", () => {
  const iso = "2026-11-09T20:15:00Z";

  it("confirms only when a row was updated", () => {
    const outcome = outcomeFromEndUpdate([{ id: "visit" }], null);
    expect(outcome.ok).toBe(true);
    expect(endNotice(iso, outcome, "end").kind).toBe("saved");
  });

  it("does not treat a zero-row update as success and does not retry it", () => {
    const outcome = outcomeFromEndUpdate([], null);
    expect(outcome.ok).toBe(false);
    expect(outcome.retry).toBe(false);
    expect(outcome.message).toMatch(/not saved/);
    expect(endNotice(iso, outcome, "end").kind).toBe("error");
  });

  it("keeps a network failure in the queue and does not call it saved", () => {
    const outcome = outcomeFromEndUpdate(null, "Failed to fetch");
    expect(outcome.retry).toBe(true);
    const notice = endNotice(iso, outcome, "end");
    expect(notice.kind).toBe("queued");
    if (notice.kind === "queued") expect(notice.iso).toBe(iso);
    const queue = ["older", "end"];
    expect(queueAfterFailure(queue, 1, true)).toEqual(["end"]);
  });

  it("drops a rejected end update but keeps later jobs", () => {
    expect(queueAfterFailure(["end", "later"], 0, false)).toEqual(["later"]);
  });
});
