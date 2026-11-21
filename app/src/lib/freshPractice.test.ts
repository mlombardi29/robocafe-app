import { describe, expect, it } from "vitest";
import { stepSatisfied } from "./serviceFlow";
import {
  assessFreshStart,
  completionToWriteForExistingTimer,
  FRESH_NOT_READY,
  FRESH_OFFLINE,
  FRESH_UNSYNCED,
  freshStartErrorMessage,
  offerFreshStart,
  withoutRetiredVisit,
  type QueuedVisit,
} from "./freshPractice";

const retired = "visit-old";
const other = "visit-other";
const created = "visit-new";

const queue: QueuedVisit[] = [
  { kind: "completion", write: { sessionId: retired } },
  { kind: "milk", id: retired },
  { kind: "end", id: retired },
  { kind: "start", id: other },
  { kind: "completion", write: { sessionId: other } },
  { kind: "complete", id: created },
];

describe("fresh practice queue", () => {
  it("removes only the retired visit after a successful restart", () => {
    const next = withoutRetiredVisit(queue, retired);
    expect(next.map((job) => (job.kind === "completion" ? job.write.sessionId : job.id))).toEqual([
      other,
      other,
      created,
    ]);
    expect(queue).toHaveLength(6);
  });

  it("leaves the queue unchanged when the retired id is not present", () => {
    expect(withoutRetiredVisit(queue, "missing")).toEqual(queue);
  });

  it("blocks a fresh start while offline and does not ask to discard the queue", () => {
    const gate = assessFreshStart(false, false, 2);
    expect(gate.proceed).toBe(false);
    expect(gate.message).toBe(FRESH_OFFLINE);
    expect(gate.message.toLowerCase()).not.toContain("clear");
  });

  it("blocks when the queue cannot sync, including jobs left for this visit", () => {
    expect(assessFreshStart(true, false, 0).message).toBe(FRESH_UNSYNCED);
    expect(assessFreshStart(true, true, 1).proceed).toBe(false);
  });

  it("proceeds only when online and this visit has no queued saves", () => {
    expect(assessFreshStart(true, true, 0)).toEqual({ proceed: true, message: "" });
  });
});

describe("fresh practice availability", () => {
  it("offers the action only for an open practice visit", () => {
    expect(offerFreshStart(true, true, true)).toBe(true);
    expect(offerFreshStart(false, true, true)).toBe(false);
    expect(offerFreshStart(true, false, true)).toBe(false);
    expect(offerFreshStart(true, true, false)).toBe(false);
  });

  it("explains a missing database function without changing the visit", () => {
    expect(freshStartErrorMessage("Could not find the function public.start_fresh_practice", "PGRST202")).toBe(
      FRESH_NOT_READY,
    );
    expect(freshStartErrorMessage("Not allowed.")).toBe("Not allowed.");
  });

  it("does not write Done just because an old timer is running", () => {
    expect(completionToWriteForExistingTimer()).toBeNull();
    expect(stepSatisfied({ key: "start_milk_clean" }, undefined, "2026-11-09T15:00:00Z")).toBe(true);
  });
});
