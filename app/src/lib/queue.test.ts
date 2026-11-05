import { describe, expect, it } from "vitest";
import { completionsForOpenVisit, mergeCompletions, reduceCompletions, reduceStarts, type CompletionWrite } from "./queue";

const write = (partial: Partial<CompletionWrite>): CompletionWrite => ({
  sessionId: "session-1",
  itemId: "item-1",
  idempotencyKey: "key-1",
  clientRev: 1,
  state: "done",
  note: "",
  overrideReason: "",
  value: "",
  ...partial,
});

describe("idempotent saves", () => {
  it("keeps one visit when Start is tapped five times", () => {
    const starts = Array.from({ length: 5 }, () => ({
      id: "same-id",
      siteId: "sinai",
      start: "2026-11-09T14:00:00Z",
    }));
    expect(reduceStarts(starts)).toHaveLength(1);
  });

  it("keeps one completion when the same step is saved again", () => {
    const rows = reduceCompletions([
      write({ clientRev: 1, state: "done" }),
      write({ clientRev: 1, state: "done", idempotencyKey: "key-1" }),
      write({ clientRev: 2, state: "not_needed", note: "already empty", idempotencyKey: "key-2" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("not_needed");
    expect(rows[0]?.idempotencyKey).toBe("key-1");
    expect(rows[0]?.note).toBe("already empty");
  });

  it("ignores an older replay after a newer save", () => {
    const rows = reduceCompletions([
      write({ clientRev: 3, state: "done" }),
      write({ clientRev: 2, state: "not_needed" }),
    ]);
    expect(rows[0]?.state).toBe("done");
    expect(rows[0]?.clientRev).toBe(3);
  });

  it("does not apply taps saved for a different visit", () => {
    const oldTap = write({ sessionId: "finished-visit", state: "done" });
    const draft = write({ sessionId: "offline-draft", state: "not_needed" });
    expect(completionsForOpenVisit({ sessionId: "finished-visit", completions: [oldTap] }, "new-visit")).toEqual([]);
    expect(completionsForOpenVisit({ sessionId: "offline-draft", completions: [draft] }, null)).toEqual([draft]);
    expect(completionsForOpenVisit({ sessionId: "new-visit", completions: [oldTap, write({ sessionId: "new-visit" })] }, "new-visit")).toEqual([
      write({ sessionId: "new-visit" }),
    ]);
  });

  it("merges the phone queue over the server when the phone is newer", () => {
    const merged = mergeCompletions(
      [write({ clientRev: 1, state: "done", note: "server" })],
      [write({ clientRev: 4, state: "done", note: "phone" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.note).toBe("phone");
  });
});
