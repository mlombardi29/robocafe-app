import { describe, expect, it } from "vitest";
import { acceptStartResult, startRequest } from "./startRequest";

describe("atomic photo start", () => {
  const job = { kind: "start" as const, id: "11111111-1111-4111-8111-111111111111", siteId: "22222222-2222-4222-8222-222222222222", start: "2026-11-08T15:00:00Z", estimated: false };

  it("asks for the photo rule in the start call and does not make a second call", () => {
    expect(startRequest({ ...job })).not.toHaveProperty("p_photo_audit");
    expect(startRequest({ ...job, photoAudit: true }).p_photo_audit).toBe(true);
  });

  it("rejects a start that came back without a checklist snapshot", () => {
    expect(acceptStartResult(true, null)).toBe(false);
    expect(acceptStartResult(true, { checklist_snapshot: null })).toBe(false);
    expect(acceptStartResult(true, { checklist_snapshot: {} })).toBe(true);
    expect(acceptStartResult(true, { checklist_snapshot: { photo_audit: { required: true } } })).toBe(true);
    expect(acceptStartResult(false, { checklist_snapshot: {} })).toBe(true);
  });
});
