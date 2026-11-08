import { parseWorkbook, type WorkbookCsv } from "./adapters";
import { applyMappings, fingerprintPayload } from "./mappings";
import { MigrateStore } from "./store";
import { LEGACY_TABS, type LegacyTab } from "./tabs";
import type {
  Finding,
  MappingTables,
  MigrateMode,
  ParsedRow,
  RehearsalStats,
  StagedRecord,
} from "./types";

export const NOT_A_LIVE_MIGRATION =
  "This is a local migration rehearsal only. It is not a live cutover, does not write to hosted Supabase, and fixture success does not prove real legacy data correctness.";

function kindFor(tab: LegacyTab): StagedRecord["kind"] {
  if (tab === "ServiceSessions") return "visit";
  if (tab === "Payments") return "payment";
  if (tab === "Charges") return "charge";
  return "other";
}

function stageRow(row: ParsedRow): StagedRecord | null {
  if (!row.legacyId) return null;
  if (row.findings.some((f) => ["ambiguous_columns", "missing_stable_id", "secret_config_held"].includes(f.code))) {
    return null;
  }
  const payload: Record<string, unknown> = { ...row.fields, _tab: row.tab };
  return {
    kind: kindFor(row.tab),
    legacyId: row.legacyId,
    fingerprint: fingerprintPayload(payload),
    payload,
    sourceTab: row.tab,
  };
}

export function resolveMode(raw: string | undefined | null): { mode: MigrateMode; findings: Finding[] } {
  const value = (raw ?? "dry_run").trim().toLowerCase();
  if (value === "" || value === "dry_run") return { mode: "dry_run", findings: [] };
  if (value === "local_apply") return { mode: "local_apply", findings: [] };
  return {
    mode: "dry_run",
    findings: [
      {
        tab: "(workbook)",
        legacyId: "",
        code: "live_mode_blocked",
        detail: `Mode "${raw}" is not allowed. Only dry_run (default) or local_apply. Hosted/live writes are fail-closed.`,
        ready: false,
      },
    ],
  };
}

export function rehearseImport(options: {
  csvByTab: WorkbookCsv;
  maps: MappingTables;
  store: MigrateStore;
  mode?: string | null;
  connectionString?: string | null;
}): RehearsalStats {
  const findings: Finding[] = [];
  const modeResolved = resolveMode(options.mode);
  findings.push(...modeResolved.findings);
  let mode = modeResolved.mode;

  if (options.connectionString && options.connectionString.trim() !== "") {
    findings.push({
      tab: "(workbook)",
      legacyId: "",
      code: "live_mode_blocked",
      detail: "A database connection string was supplied. Rehearsal refuses hosted writes and stays on the in-memory store.",
      ready: false,
    });
    mode = "dry_run";
  }

  const parsed = parseWorkbook(options.csvByTab);
  findings.push(...parsed.findings);

  const allRows: ParsedRow[] = [];
  for (const tab of LEGACY_TABS) allRows.push(...parsed.tabs[tab].rows);
  const mapped = applyMappings(allRows, options.maps);
  findings.push(...mapped.findings);

  const tabCounts = {} as RehearsalStats["tabCounts"];
  for (const tab of LEGACY_TABS) {
    tabCounts[tab] = {
      source: parsed.tabs[tab].rows.length,
      staged: 0,
      held: parsed.tabs[tab].held,
    };
  }

  let inserted = 0;
  let unchangedReplay = 0;
  let conflicts = 0;
  let writesAttempted = 0;
  let writesApplied = 0;

  if (mode === "local_apply") options.store.snapshot();

  for (const row of mapped.rows) {
    const staged = stageRow(row);
    if (!staged) continue;
    tabCounts[row.tab].staged += 1;
    writesAttempted += 1;
    if (mode === "dry_run") {
      const existing = options.store.get(staged.kind, staged.legacyId);
      if (existing?.preexisting && existing.fingerprint !== staged.fingerprint) {
        conflicts += 1;
        findings.push({
          tab: row.tab,
          legacyId: staged.legacyId,
          code: staged.kind === "payment" ? "conflict_existing_payment" : staged.kind === "visit" ? "conflict_existing_visit" : "conflict_payload",
          detail: "Dry-run detected a conflict with a preexisting KioskOps record. No overwrite.",
          ready: false,
        });
      } else if (existing && existing.fingerprint !== staged.fingerprint && !existing.preexisting) {
        conflicts += 1;
        findings.push({
          tab: row.tab,
          legacyId: staged.legacyId,
          code: "conflict_payload",
          detail: "Dry-run detected a payload conflict on replay. No overwrite.",
          ready: false,
        });
      } else if (existing) {
        unchangedReplay += 1;
      } else {
        inserted += 1;
      }
      continue;
    }

    const result = options.store.upsertStaged(staged);
    if (result === "inserted") {
      inserted += 1;
      writesApplied += 1;
    } else if (result === "unchanged") {
      unchangedReplay += 1;
    } else {
      conflicts += 1;
      findings.push({
        tab: row.tab,
        legacyId: staged.legacyId,
        code:
          result === "conflict_existing" && staged.kind === "payment"
            ? "conflict_existing_payment"
            : result === "conflict_existing" && staged.kind === "visit"
              ? "conflict_existing_visit"
              : result === "conflict_existing"
                ? "conflict_payload"
                : "conflict_payload",
        detail:
          result === "conflict_existing"
            ? "Preexisting KioskOps record preserved. Import row left unresolved."
            : "Replay payload differs from staged record. Existing row preserved.",
        ready: false,
      });
    }
  }

  if (mode === "dry_run") {
    findings.push({
      tab: "(workbook)",
      legacyId: "",
      code: "write_blocked",
      detail: "dry_run default: staged counts only; in-memory store not mutated by import rows.",
      ready: false,
    });
  }

  return {
    mode,
    tabCounts,
    inserted,
    unchangedReplay,
    conflicts,
    findings,
    writesAttempted,
    writesApplied,
    caveat: NOT_A_LIVE_MIGRATION,
  };
}

export function rollbackLastApply(store: MigrateStore): { ok: boolean; detail: string } {
  const ok = store.rollback();
  return {
    ok,
    detail: ok
      ? "Rolled back to the snapshot taken before local_apply. Preexisting records remain."
      : "No local_apply snapshot to roll back.",
  };
}
