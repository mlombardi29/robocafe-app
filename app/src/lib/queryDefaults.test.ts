import { describe, expect, it } from "vitest";
import { isLiveQueryKey, READ_STALE_MS } from "./queryDefaults";

describe("queryDefaults", () => {
  it("keeps a short warm window for read screens", () => {
    expect(READ_STALE_MS).toBe(60_000);
  });

  it("treats service and stock paths as live", () => {
    expect(isLiveQueryKey(["service", "site"])).toBe(true);
    expect(isLiveQueryKey(["inventory"])).toBe(true);
    expect(isLiveQueryKey(["history"])).toBe(false);
    expect(isLiveQueryKey(["ops-board"])).toBe(false);
  });
});
