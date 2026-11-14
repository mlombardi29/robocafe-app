import { describe, expect, it } from "vitest";
import { bestOfCluster, findDuplicateClusters, type SessionDupRow } from "./duplicateSessions";

function row(partial: Partial<SessionDupRow> & Pick<SessionDupRow, "id">): SessionDupRow {
  return {
    site_id: "site-a",
    person_id: "tech-a",
    service_date: "2026-11-01",
    start_at: "2026-11-01T14:00:00.000Z",
    end_at: "2026-11-01T15:00:00.000Z",
    status: "completed",
    created_at: "2026-11-01T14:00:00.000Z",
    ...partial,
  };
}

describe("duplicateSessions", () => {
  it("keeps the completed longer visit over a shorter open twin", () => {
    const keep = bestOfCluster([
      row({ id: "short", status: "open", end_at: "2026-11-01T14:20:00.000Z" }),
      row({ id: "long", status: "completed", end_at: "2026-11-01T16:00:00.000Z" }),
    ]);
    expect(keep.id).toBe("long");
  });

  it("clusters identical start minutes as same-start duplicates", () => {
    const clusters = findDuplicateClusters([
      row({ id: "a", created_at: "2026-11-01T14:00:00.000Z" }),
      row({ id: "b", created_at: "2026-11-01T14:10:00.000Z", end_at: "2026-11-01T14:30:00.000Z" }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].reason).toBe("same-start");
    expect(clusters[0].keepId).toBe("a");
    expect(clusters[0].voidIds).toEqual(["b"]);
  });

  it("clusters different starts saved within three minutes as a race window", () => {
    const clusters = findDuplicateClusters([
      row({
        id: "first",
        start_at: "2026-11-01T14:00:00.000Z",
        created_at: "2026-11-01T14:00:00.000Z",
        end_at: "2026-11-01T15:00:00.000Z",
      }),
      row({
        id: "second",
        start_at: "2026-11-01T14:01:00.000Z",
        created_at: "2026-11-01T14:00:45.000Z",
        end_at: "2026-11-01T14:20:00.000Z",
      }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].reason).toBe("race-window");
    expect(clusters[0].keepId).toBe("first");
    expect(clusters[0].voidIds).toEqual(["second"]);
  });

  it("ignores voided rows and singles", () => {
    expect(
      findDuplicateClusters([
        row({ id: "only" }),
        row({ id: "voided", status: "voided", created_at: "2026-11-01T14:00:10.000Z" }),
      ]),
    ).toEqual([]);
  });
});
