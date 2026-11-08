import type { ExistingRecord, StagedRecord } from "./types";

/** In-memory rehearsal store. Never opens a hosted database. */
export class MigrateStore {
  private records = new Map<string, ExistingRecord>();
  private snapshots: Array<Map<string, ExistingRecord>> = [];

  constructor(seed: ExistingRecord[] = []) {
    for (const row of seed) this.records.set(this.key(row.kind, row.legacyId), { ...row });
  }

  private key(kind: ExistingRecord["kind"], legacyId: string): string {
    return `${kind}:${legacyId}`;
  }

  snapshot(): void {
    const copy = new Map<string, ExistingRecord>();
    for (const [key, value] of this.records) copy.set(key, { ...value, payload: { ...value.payload } });
    this.snapshots.push(copy);
  }

  rollback(): boolean {
    const prior = this.snapshots.pop();
    if (!prior) return false;
    this.records = prior;
    return true;
  }

  get(kind: ExistingRecord["kind"], legacyId: string): ExistingRecord | undefined {
    return this.records.get(this.key(kind, legacyId));
  }

  list(kind?: ExistingRecord["kind"]): ExistingRecord[] {
    const all = [...this.records.values()];
    return kind ? all.filter((row) => row.kind === kind) : all;
  }

  upsertStaged(row: StagedRecord): "inserted" | "unchanged" | "conflict_existing" | "conflict_payload" {
    const key = this.key(row.kind, row.legacyId);
    const current = this.records.get(key);
    if (!current) {
      this.records.set(key, {
        kind: row.kind,
        legacyId: row.legacyId,
        fingerprint: row.fingerprint,
        preexisting: false,
        payload: row.payload,
      });
      return "inserted";
    }
    if (current.preexisting) {
      if (current.fingerprint !== row.fingerprint) return "conflict_existing";
      return "unchanged";
    }
    if (current.fingerprint !== row.fingerprint) return "conflict_payload";
    return "unchanged";
  }

  countsByKind(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const row of this.records.values()) out[row.kind] = (out[row.kind] ?? 0) + 1;
    return out;
  }
}
