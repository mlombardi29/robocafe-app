/** Find duplicate service sessions and pick which one to keep (legacy Code.gs rules). */

export type SessionDupRow = {
  id: string;
  site_id: string;
  person_id: string;
  service_date: string;
  start_at: string | null;
  end_at: string | null;
  status: string;
  created_at: string;
};

export type DupCluster = {
  key: string;
  keepId: string;
  voidIds: string[];
  reason: "same-start" | "race-window";
  rows: SessionDupRow[];
};

function startKey(startAt: string | null): string | null {
  if (!startAt) return null;
  // Same minute = same filed start (legacy used HH:MM strings).
  return startAt.slice(0, 16);
}

function durationMs(row: SessionDupRow): number {
  if (!row.start_at || !row.end_at) return 0;
  const ms = new Date(row.end_at).getTime() - new Date(row.start_at).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function statusRank(status: string): number {
  if (status === "completed") return 2;
  if (status === "open") return 1;
  return 0;
}

/** Keep the most complete, then longest, then newest (legacy bestOfCluster_). */
export function bestOfCluster(rows: SessionDupRow[]): SessionDupRow {
  return rows.reduce((best, row) => {
    const a = [statusRank(row.status), durationMs(row), new Date(row.created_at).getTime()];
    const b = [statusRank(best.status), durationMs(best), new Date(best.created_at).getTime()];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) || (a[0] === b[0] && a[1] === b[1] && a[2] > b[2])) {
      return row;
    }
    return best;
  });
}

function groupKey(row: SessionDupRow): string {
  return `${row.site_id}|${row.service_date}|${row.person_id}`;
}

/**
 * Same site/day/tech with (a) identical start minute, or (b) created within 3 minutes
 * of each other when starts differ/blank — the old autosave/submit race.
 */
export function findDuplicateClusters(rows: SessionDupRow[]): DupCluster[] {
  const active = rows.filter((row) => row.status !== "voided");
  const byGroup = new Map<string, SessionDupRow[]>();
  for (const row of active) {
    const key = groupKey(row);
    byGroup.set(key, [...(byGroup.get(key) ?? []), row]);
  }

  const out: DupCluster[] = [];
  for (const [key, list] of byGroup) {
    if (list.length < 2) continue;
    const used = new Set<string>();

    const byStart = new Map<string, SessionDupRow[]>();
    for (const row of list) {
      const sk = startKey(row.start_at);
      if (!sk) continue;
      byStart.set(sk, [...(byStart.get(sk) ?? []), row]);
    }
    for (const [, cluster] of byStart) {
      if (cluster.length < 2) continue;
      cluster.forEach((row) => used.add(row.id));
      const keep = bestOfCluster(cluster);
      out.push({
        key: `${key}|same-start|${startKey(keep.start_at) ?? "blank"}`,
        keepId: keep.id,
        voidIds: cluster.filter((row) => row.id !== keep.id).map((row) => row.id),
        reason: "same-start",
        rows: cluster,
      });
    }

    const rest = list
      .filter((row) => !used.has(row.id))
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (rest.length < 2) continue;
    let cluster: SessionDupRow[] = [rest[0]];
    for (let i = 1; i < rest.length; i += 1) {
      const prev = cluster[cluster.length - 1];
      const gap = Math.abs(new Date(rest[i].created_at).getTime() - new Date(prev.created_at).getTime());
      if (gap <= 180_000) {
        cluster.push(rest[i]);
      } else {
        if (cluster.length > 1) {
          const keep = bestOfCluster(cluster);
          out.push({
            key: `${key}|race|${keep.id}`,
            keepId: keep.id,
            voidIds: cluster.filter((row) => row.id !== keep.id).map((row) => row.id),
            reason: "race-window",
            rows: cluster,
          });
        }
        cluster = [rest[i]];
      }
    }
    if (cluster.length > 1) {
      const keep = bestOfCluster(cluster);
      out.push({
        key: `${key}|race|${keep.id}`,
        keepId: keep.id,
        voidIds: cluster.filter((row) => row.id !== keep.id).map((row) => row.id),
        reason: "race-window",
        rows: cluster,
      });
    }
  }
  return out;
}
