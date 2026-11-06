import { describe, expect, it } from "vitest";
import { hiddenPrompt, prepareReload, reducePrompt, shouldPromptAfterControllerChange, UI_BUILD } from "./appUpdate";

describe("service worker update prompt", () => {
  it("does not treat the first install as an update", () => {
    expect(shouldPromptAfterControllerChange(false)).toBe(false);
    expect(shouldPromptAfterControllerChange(true)).toBe(true);
  });

  it("Later dismisses the banner and does not reload or clear storage", () => {
    const next = reducePrompt({ available: true, expanded: true, warning: null }, "later");
    expect(next.reload).toBe(false);
    expect(next.clearStorage).toBe(false);
    expect(next.available).toBe(true);
    expect(next.expanded).toBe(false);
  });

  it("blocks reload while unsynced work remains", async () => {
    const decision = await prepareReload({
      flush: async () => ({ ok: false, retry: true }),
      readQueue: async () => [{ kind: "end" }],
    });
    expect(decision.reload).toBe(false);
    expect(decision.clearStorage).toBe(false);
    expect(decision.warning).toMatch(/Unsynced work/);
    const shown = reducePrompt({ available: true, expanded: true, warning: null }, "blocked", decision.warning ?? undefined);
    expect(shown.reload).toBe(false);
    expect(shown.warning).toMatch(/Nothing was erased/);
  });

  it("allows reload only after the queue is empty", async () => {
    const decision = await prepareReload({
      flush: async () => ({ ok: true, retry: false }),
      readQueue: async () => [],
    });
    expect(decision).toEqual({ reload: true, clearStorage: false, warning: null });
    expect(reducePrompt(hiddenPrompt, "reload-ok").reload).toBe(true);
    expect(reducePrompt(hiddenPrompt, "reload-ok").clearStorage).toBe(false);
  });

  it("still blocks when a flush reports success but rows remain queued", async () => {
    const decision = await prepareReload({
      flush: async () => ({ ok: true, retry: false }),
      readQueue: async () => [{ kind: "completion" }],
    });
    expect(decision.reload).toBe(false);
  });

  it("names this client build and never clears storage as part of an update", () => {
    expect(UI_BUILD).toBe("ui-2026-11-06-abcd");
    for (const action of ["available", "later", "blocked", "reload-ok"] as const) {
      expect(reducePrompt(hiddenPrompt, action).clearStorage).toBe(false);
    }
  });
});
