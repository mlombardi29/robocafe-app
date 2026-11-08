/**
 * Local eleven-tab migration rehearsal CLI.
 * Default mode: dry_run. Never opens hosted Supabase.
 *
 *   npx tsx scripts/migrate/rehearse.ts
 *   KIOSKOPS_MIGRATE_MODE=local_apply npx tsx scripts/migrate/rehearse.ts
 *
 * Optional fixture directory of CSV files named exactly after tab names (SKUs.csv, …).
 * Without a directory, uses synthetic fixtures only.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  LEGACY_TABS,
  MigrateStore,
  NOT_A_LIVE_MIGRATION,
  preexistingRecords,
  reconcileWorkbook,
  rehearseImport,
  rollbackLastApply,
  syntheticMappings,
  syntheticWorkbook,
  type WorkbookCsv,
} from "../../app/src/lib/migrate/index.ts";

function loadWorkbook(dir: string | undefined): WorkbookCsv {
  if (!dir) return syntheticWorkbook();
  const abs = resolve(dir);
  if (!existsSync(abs)) throw new Error(`Fixture directory missing: ${abs}`);
  const files = new Set(readdirSync(abs));
  const out: WorkbookCsv = {};
  for (const tab of LEGACY_TABS) {
    const name = `${tab}.csv`;
    if (!files.has(name)) continue;
    out[tab] = readFileSync(resolve(abs, name), "utf8");
  }
  return out;
}

const dir = process.env.KIOSKOPS_MIGRATE_FIXTURES;
const mode = process.env.KIOSKOPS_MIGRATE_MODE ?? "dry_run";
const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? "";

const csvByTab = loadWorkbook(dir);
const store = new MigrateStore(preexistingRecords());
const first = rehearseImport({
  csvByTab,
  maps: syntheticMappings(),
  store,
  mode,
  connectionString,
});

console.log(JSON.stringify({
  caveat: NOT_A_LIVE_MIGRATION,
  mode: first.mode,
  inserted: first.inserted,
  unchangedReplay: first.unchangedReplay,
  conflicts: first.conflicts,
  writesAttempted: first.writesAttempted,
  writesApplied: first.writesApplied,
  findingCodes: [...new Set(first.findings.map((f) => f.code))],
  findingCount: first.findings.length,
  tabCounts: first.tabCounts,
}, null, 2));

if (first.mode === "local_apply") {
  const replay = rehearseImport({
    csvByTab,
    maps: syntheticMappings(),
    store,
    mode: "local_apply",
  });
  console.log(JSON.stringify({
    replayInserted: replay.inserted,
    replayUnchanged: replay.unchangedReplay,
    replayConflicts: replay.conflicts,
  }, null, 2));
  const report = reconcileWorkbook(csvByTab, store);
  console.log(JSON.stringify({
    reconciliationMismatches: report.mismatches.length,
    paymentTotal: report.paymentTotal,
    chargeTotal: report.chargeTotal,
    stockSamples: report.stockBySku.slice(0, 5),
  }, null, 2));
  const rolled = rollbackLastApply(store);
  console.log(JSON.stringify(rolled, null, 2));
}
