/**
 * Local JSON snapshot apply / replay / undo for ADD candidates only.
 * Not hosted DB verification.
 */

import type { CurrentSnapshot } from "./transferPreview";
import type { PreviewDecision } from "./transferPreview";
import { PREVIEW_LIMITATION } from "./transferPreview";

export type LocalRecord = {
  collection: string;
  legacy_id: string;
  preexisting: boolean;
  batchId?: string;
  payload: Record<string, unknown>;
};

export type LocalSnapshotState = {
  limitation: string;
  batchId: string;
  records: Map<string, LocalRecord>;
  snapshots: Array<Map<string, LocalRecord>>;
};

function key(collection: string, legacyId: string): string {
  return `${collection}:${legacyId}`;
}

function cloneMap(source: Map<string, LocalRecord>): Map<string, LocalRecord> {
  const out = new Map<string, LocalRecord>();
  for (const [k, v] of source) {
    out.set(k, { ...v, payload: { ...v.payload } });
  }
  return out;
}

export function createLocalSnapshotState(
  current: CurrentSnapshot,
  batchId = `preview-${Date.now()}`,
): LocalSnapshotState {
  const records = new Map<string, LocalRecord>();
  const seed = (
    collection: string,
    rows: Array<Record<string, unknown>>,
    legacyField = "legacy_id",
  ) => {
    for (const row of rows) {
      const legacyId = String(row[legacyField] ?? row.id ?? "");
      if (!legacyId) continue;
      records.set(key(collection, legacyId), {
        collection,
        legacy_id: legacyId,
        preexisting: true,
        payload: { ...row },
      });
    }
  };
  seed("visits", current.visits);
  seed("people", current.people);
  seed("sites", current.sites);
  seed("payments", current.payments);
  seed("charges", current.charges);
  seed("skus", current.skus);
  seed("inventory_tx", current.inventory_tx ?? []);
  seed("stock_flags", current.stock_flags ?? []);
  seed("site_skus", current.site_skus ?? []);
  return { limitation: PREVIEW_LIMITATION, batchId, records, snapshots: [] };
}

function collectionFor(decision: PreviewDecision): string | null {
  switch (decision.tab) {
    case "ServiceSessions":
      return "visits";
    case "SKUs":
      return "skus";
    case "Transactions":
      return "inventory_tx";
    case "KioskFlags":
      return "stock_flags";
    case "LocationSKUs":
      return "site_skus";
    case "Payments":
      return "payments";
    case "Charges":
      return "charges";
    case "ScheduleOverrides":
      return "schedule_overrides";
    case "People":
      return "people";
    case "Locations":
      return "sites";
    default:
      return null;
  }
}

export function applyAddCandidates(
  state: LocalSnapshotState,
  decisions: PreviewDecision[],
): {
  inserted: number;
  unchanged: number;
  conflicts: number;
  details: string[];
} {
  state.snapshots.push(cloneMap(state.records));
  let inserted = 0;
  let unchanged = 0;
  let conflicts = 0;
  const details: string[] = [];
  for (const decision of decisions) {
    if (decision.action !== "ADD") continue;
    const collection = collectionFor(decision);
    if (!collection || !decision.legacyId) continue;
    const k = key(collection, decision.legacyId);
    const existing = state.records.get(k);
    if (existing?.preexisting) {
      conflicts += 1;
      details.push(`conflict preexisting ${k}`);
      continue;
    }
    if (existing && existing.batchId === state.batchId) {
      unchanged += 1;
      continue;
    }
    if (existing) {
      conflicts += 1;
      details.push(`conflict other ${k}`);
      continue;
    }
    state.records.set(k, {
      collection,
      legacy_id: decision.legacyId,
      preexisting: false,
      batchId: state.batchId,
      payload: { ...(decision.payload ?? {}), legacy_id: decision.legacyId },
    });
    inserted += 1;
  }
  return { inserted, unchanged, conflicts, details };
}

export function replayAddCandidates(
  state: LocalSnapshotState,
  decisions: PreviewDecision[],
): { inserted: number; unchanged: number; conflicts: number } {
  // Replay without new snapshot — should not duplicate batch rows.
  let inserted = 0;
  let unchanged = 0;
  let conflicts = 0;
  for (const decision of decisions) {
    if (decision.action !== "ADD") continue;
    const collection = collectionFor(decision);
    if (!collection || !decision.legacyId) continue;
    const existing = state.records.get(key(collection, decision.legacyId));
    if (!existing) inserted += 1; // would insert if missing
    else if (existing.preexisting) conflicts += 1;
    else unchanged += 1;
  }
  // Actually insert only missing (idempotent)
  const result = applyAddCandidates(state, decisions);
  // Drop the extra snapshot from nested apply — keep one logical batch snapshot.
  if (state.snapshots.length >= 2) {
    const latest = state.snapshots.pop()!;
    state.records = latest;
    // re-apply once onto previous snapshot already taken by first apply
  }
  return { inserted: result.inserted, unchanged: result.unchanged + unchanged, conflicts: result.conflicts + conflicts };
}

/** Safer replay: count-only then ensure zero new inserts when all ADD keys exist. */
export function idempotentReplay(
  state: LocalSnapshotState,
  decisions: PreviewDecision[],
): { inserted: number; unchanged: number; conflicts: number } {
  let inserted = 0;
  let unchanged = 0;
  let conflicts = 0;
  for (const decision of decisions) {
    if (decision.action !== "ADD") continue;
    const collection = collectionFor(decision);
    if (!collection || !decision.legacyId) continue;
    const existing = state.records.get(key(collection, decision.legacyId));
    if (!existing) {
      // insert once
      state.records.set(key(collection, decision.legacyId), {
        collection,
        legacy_id: decision.legacyId,
        preexisting: false,
        batchId: state.batchId,
        payload: { ...(decision.payload ?? {}), legacy_id: decision.legacyId },
      });
      inserted += 1;
    } else if (existing.preexisting) {
      conflicts += 1;
    } else {
      unchanged += 1;
    }
  }
  return { inserted, unchanged, conflicts };
}

export function undoLastBatch(state: LocalSnapshotState): {
  ok: boolean;
  removed: number;
  preexistingRemaining: number;
  detail: string;
} {
  const prior = state.snapshots.pop();
  if (!prior) {
    return {
      ok: false,
      removed: 0,
      preexistingRemaining: [...state.records.values()].filter((r) => r.preexisting).length,
      detail: "No batch snapshot to undo.",
    };
  }
  const before = state.records.size;
  state.records = prior;
  const removed = before - state.records.size;
  const preexistingRemaining = [...state.records.values()].filter((r) => r.preexisting).length;
  return {
    ok: true,
    removed,
    preexistingRemaining,
    detail: "Undo restored the local snapshot copy taken before this batch. Preexisting rows were not deleted by undo.",
  };
}

export function injectConflict(
  state: LocalSnapshotState,
  collection: string,
  legacyId: string,
  payload: Record<string, unknown>,
): void {
  state.records.set(key(collection, legacyId), {
    collection,
    legacy_id: legacyId,
    preexisting: true,
    payload,
  });
}

export function countByCollection(state: LocalSnapshotState): Record<string, { total: number; preexisting: number; added: number }> {
  const out: Record<string, { total: number; preexisting: number; added: number }> = {};
  for (const row of state.records.values()) {
    const bucket = out[row.collection] ?? { total: 0, preexisting: 0, added: 0 };
    bucket.total += 1;
    if (row.preexisting) bucket.preexisting += 1;
    else bucket.added += 1;
    out[row.collection] = bucket;
  }
  return out;
}

export function preexistingFingerprints(state: LocalSnapshotState): string[] {
  return [...state.records.values()]
    .filter((row) => row.preexisting)
    .map((row) => `${row.collection}:${row.legacy_id}:${JSON.stringify(row.payload)}`)
    .sort();
}
