import { describe, expect, it } from "vitest";
import { acceptStartResult, photoAuditArgMissing, startRequest, withoutPhotoArg } from "./startRequest";

describe("atomic photo start", () => {
  const job = { kind: "start" as const, id: "11111111-1111-4111-8111-111111111111", siteId: "22222222-2222-4222-8222-222222222222", start: "2026-11-08T15:00:00Z", estimated: false };

  it("asks for the photo rule in the start call and does not make a second call", () => {
    expect(startRequest({ ...job })).not.toHaveProperty("p_photo_audit");
    expect(startRequest({ ...job, photoAudit: true }).p_photo_audit).toBe(true);
  });

  it("falls back only when the photo argument is missing from start_session", () => {
    expect(photoAuditArgMissing({ code: "PGRST202", message: "Could not find the function public.start_session(p_id, p_photo_audit) in the schema cache" })).toBe(true);
    expect(photoAuditArgMissing({ message: "Could not find the function start_session(p_photo_audit) in the schema cache" })).toBe(true);
    expect(photoAuditArgMissing({ code: "PGRST202", message: "Could not find the function public.set_milk_clean" })).toBe(false);
    expect(photoAuditArgMissing({ message: "Not allowed." })).toBe(false);
    expect(photoAuditArgMissing({ message: "Failed to fetch" })).toBe(false);
    expect(photoAuditArgMissing({ code: "42501", message: "permission denied for function start_session" })).toBe(false);
    const args = startRequest({ ...job, photoAudit: true });
    expect(withoutPhotoArg(args)).not.toHaveProperty("p_photo_audit");
  });

  it("rejects a start that came back without a checklist snapshot", () => {
    expect(acceptStartResult(true, null)).toBe(false);
    expect(acceptStartResult(true, { checklist_snapshot: null })).toBe(false);
    expect(acceptStartResult(true, { checklist_snapshot: {} })).toBe(true);
    expect(acceptStartResult(true, { checklist_snapshot: { photo_audit: { required: true } } })).toBe(true);
    expect(acceptStartResult(false, { checklist_snapshot: {} })).toBe(true);
  });
});
