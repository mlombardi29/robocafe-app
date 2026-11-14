import { describe, expect, it, vi } from "vitest";
import { createPendingGate, runPending } from "./pendingAction";

describe("runPending", () => {
  it("runs once and ignores a second click while busy", async () => {
    const gate = createPendingGate();
    let busy = "";
    const setBusy = (next: string) => {
      busy = next;
    };
    const work = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const first = runPending(gate, setBusy, "save", work);
    const second = runPending(gate, setBusy, "save", work);
    expect(busy).toBe("save");
    await Promise.all([first, second]);
    expect(work).toHaveBeenCalledTimes(1);
    expect(busy).toBe("");
    expect(gate.current).toBe("");
  });
});
