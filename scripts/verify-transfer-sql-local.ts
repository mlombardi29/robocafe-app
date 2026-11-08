/**
 * Local PostgreSQL transfer SQL/RLS/restore gate.
 * Reuses prior JSON preview decisions; does not rerun classification logic as authority —
 * rebuilds from same private sanitized inputs for SQL apply proof only.
 *
 * Hosted writes: never. No Google. No Netlify. No PINs in output.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEGACY_TABS,
  parseWorkbook,
  buildTransferPreview,
  type CurrentSnapshot,
  type ComparisonEvidence,
} from "../app/src/lib/migrate/index.ts";
import {
  SQL_LOCAL_LIMITATION,
  classifySqlReadiness,
  summarizeSqlReadiness,
  skuInsertPlan,
  sanitizeCurrentForSeed,
  modelCodeForSiteName,
} from "../app/src/lib/migrate/sqlLocalApply.ts";

const require = createRequire("/tmp/node_modules/pg/package.json");
const { Client } = require("pg") as typeof import("pg");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privateRoot =
  process.env.TRANSFER_PRIVATE_ROOT ??
  "/cursor/stores/bc-f5297e3b-d424-5cd9-a8f4-d68a5d70cce7/private-migrate-dryrun-2026-11-08";
const dbName = "kioskops_transfer_sql";
const databaseUrl =
  process.env.DATABASE_URL ?? `postgresql:///${dbName}?host=/var/run/postgresql`;
const outDir = resolve("/opt/cursor/artifacts/private-transfer-sql-local-2026-11-08");
const privateOut = resolve(privateRoot, "sql-local-gate");

const base = [
  "0001_schema.sql",
  "0002_rls_grants.sql",
  "0003_seed_content.sql",
  "0004_sandbox.sql",
  "0005_harden_definer_functions.sql",
  "0006_fresh_practice.sql",
  "0007_milk_lock_not_needed.sql",
  "0008_phase1_batches.sql",
  "0009_phase2_pay_inventory.sql",
  "0010_milk_order_guidance.sql",
];

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function sha256(buf: Buffer | string) {
  return createHash("sha256").update(buf).digest("hex");
}

function fileSql(name: string) {
  return readFileSync(resolve(root, "supabase/migrations", name), "utf8");
}

function psql(sql: string, ok = true, tuples = false) {
  const args = [databaseUrl, "-v", "ON_ERROR_STOP=1"];
  if (tuples) args.push("-t", "-A");
  args.push("-f", "-");
  const result = spawnSync("psql", args, { input: sql, encoding: "utf8" });
  if (ok && result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "psql failed");
  }
  return result;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(privateOut, { recursive: true });

  const zipPath = resolve(privateRoot, "input/kioskops-legacy-11-tabs-sanitized-2026-11-07_15ff.zip");
  const snapPath = resolve(privateRoot, "current-snapshot/current-snapshot_3186.json");
  const comparisonPath = resolve(privateRoot, "comparison/comparison-evidence_6683.json");
  const csvDir = resolve(privateRoot, "extracted/legacy-source");
  assert(existsSync(zipPath) && existsSync(snapPath) && existsSync(comparisonPath), "private sanitized inputs missing");

  const zipSha = sha256(readFileSync(zipPath));
  assert(
    zipSha === "dfd85c1f6ed9d36eeee264200ab32c8356c4e4dc244e4c433359de9ee2a67ae7",
    `zip hash mismatch: ${zipSha}`,
  );

  const current = JSON.parse(readFileSync(snapPath, "utf8")) as CurrentSnapshot;
  const comparison = JSON.parse(readFileSync(comparisonPath, "utf8")) as ComparisonEvidence;
  const csvByTab: Record<string, string> = {};
  for (const tab of LEGACY_TABS) {
    csvByTab[tab] = readFileSync(resolve(csvDir, `${tab}.csv`), "utf8");
  }
  const parsed = parseWorkbook(csvByTab);
  const preview = buildTransferPreview({ tabs: parsed.tabs, current, comparison });

  // Confirm prior JSON totals without claiming new classification work
  assert(preview.keepCurrent.length === 16, `KEEP expected 16 got ${preview.keepCurrent.length}`);
  assert(preview.addCandidates.length === 669, `ADD expected 669 got ${preview.addCandidates.length}`);
  assert(preview.reviewQueue.length === 309, `REVIEW expected 309 got ${preview.reviewQueue.length}`);
  assert(preview.excluded.length === 0, `EXCLUDED expected 0 got ${preview.excluded.length}`);

  // Classify ADD/REVIEW/EXCLUDED only — KEEP is preexisting seed, not an apply candidate.
  const applyDecisions = [
    ...preview.addCandidates,
    ...preview.reviewQueue,
    ...preview.excluded,
  ];
  const reports = applyDecisions.map((d) => classifySqlReadiness(d, {}));
  const summary = summarizeSqlReadiness(reports);

  // Recreate DB
  const dropDb = spawnSync(
    "psql",
    ["postgresql:///postgres?host=/var/run/postgresql", "-v", "ON_ERROR_STOP=1", "-c", `drop database if exists ${dbName};`],
    { encoding: "utf8" },
  );
  assert(dropDb.status === 0, dropDb.stderr);
  const createDb = spawnSync(
    "psql",
    ["postgresql:///postgres?host=/var/run/postgresql", "-v", "ON_ERROR_STOP=1", "-c", `create database ${dbName} owner ubuntu;`],
    { encoding: "utf8" },
  );
  assert(createDb.status === 0, createDb.stderr);

  psql(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  for (const name of base) psql(fileSql(name));

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  // Clear seed sites/people so snapshot UUIDs can be KEEP-seeded; keep models/templates.
  await client.query(`
    truncate table
      public.service_item_completions,
      public.service_sessions,
      public.person_sites,
      public.people,
      public.sites,
      public.payments,
      public.charges,
      public.skus,
      public.site_skus,
      public.stock_flags,
      public.inventory_tx,
      public.show_days
    restart identity cascade;
  `);

  const models = await client.query<{ id: string; code: string }>(`select id, code from public.models`);
  const modelByCode = Object.fromEntries(models.rows.map((r) => [r.code, r.id]));
  const seed = sanitizeCurrentForSeed(current);

  for (const site of seed.sites) {
    const code = modelCodeForSiteName(site.name, site.short_name);
    const modelId = modelByCode[code];
    assert(modelId, `missing model ${code}`);
    await client.query(
      `insert into public.sites (id, name, short_name, model_id, cadence, active, is_sandbox)
       values ($1,$2,$3,$4,'daily',$5,$6)`,
      [site.id, site.name, site.short_name, modelId, site.active, site.is_sandbox],
    );
  }

  const adminId = seed.people.find((p) => p.role === "admin")?.id ?? seed.people[0]?.id;
  for (const person of seed.people) {
    await client.query(
      `insert into public.people (id, auth_user_id, full_name, goes_by, role, active, mode, is_sandbox)
       values ($1,$1,$2,$2,$3,$4,$5,$6)`,
      [person.id, person.goes_by, person.role, person.active, person.mode, person.is_sandbox],
    );
  }
  // person_sites for non-practice sites
  for (const person of seed.people) {
    for (const site of seed.sites.filter((s) => !s.is_sandbox)) {
      await client.query(
        `insert into public.person_sites (person_id, site_id, is_sandbox) values ($1,$2,false)`,
        [person.id, site.id],
      );
    }
  }

  for (const visit of seed.visits) {
    await client.query(
      `insert into public.service_sessions (
         id, site_id, person_id, service_date, status, start_at, end_at,
         is_sandbox, legacy_id, submitted_at, checklist_snapshot
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}'::jsonb)`,
      [
        visit.id,
        visit.site_id,
        visit.person_id,
        visit.service_date,
        visit.status,
        visit.start_at,
        visit.end_at,
        visit.is_sandbox,
        visit.legacy_id,
        visit.submitted_at,
      ],
    );
  }

  // Seed a payment for preservation (current snapshot payments=0)
  const payId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
  const payPerson = seed.people[0].id;
  await client.query(
    `insert into public.payments (id, person_id, amount, voided, is_sandbox, legacy_id)
     values ($1,$2,1.00,false,false,'seed-preserve-pay')`,
    [payId, payPerson],
  );

  const beforeVisits = await client.query<{ n: number }>(`select count(*)::int as n from public.service_sessions`);
  const beforePay = await client.query<{ amount: string }>(`select amount::text as amount from public.payments where id = $1`, [
    payId,
  ]);
  const beforeVisitFp = await client.query<{ fp: string }>(
    `select string_agg(id::text || ':' || coalesce(legacy_id,'') || ':' || status, '|' order by id) as fp from public.service_sessions`,
  );

  // Transactional rollback of SKU ADD batch
  const readySkus = preview.addCandidates
    .filter((d) => d.tab === "SKUs")
    .map((d) => skuInsertPlan(d))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  assert(readySkus.length === 27, `expected 27 ready SKUs, got ${readySkus.length}`);

  await client.query("BEGIN");
  for (const sku of readySkus) {
    await client.query(
      `insert into public.skus (legacy_id, name, base_unit, active, reorder_threshold)
       select $1,$2,$3,$4,$5
       where not exists (select 1 from public.skus where legacy_id = $1)`,
      [sku.legacyId, sku.name, sku.baseUnit, sku.active, sku.reorderThreshold],
    );
  }
  const midCount = await client.query<{ n: number }>(`select count(*)::int as n from public.skus`);
  assert(midCount.rows[0].n === 27, `rollback setup expected 27 skus, got ${midCount.rows[0].n}`);
  await client.query("ROLLBACK");
  const afterRoll = await client.query<{ n: number }>(`select count(*)::int as n from public.skus`);
  assert(afterRoll.rows[0].n === 0, "SKU batch rollback failed");

  // Commit SKU ADD
  let inserted = 0;
  for (const sku of readySkus) {
    const res = await client.query(
      `insert into public.skus (legacy_id, name, base_unit, active, reorder_threshold)
       select $1,$2,$3,$4,$5
       where not exists (select 1 from public.skus where legacy_id = $1)
       returning id`,
      [sku.legacyId, sku.name, sku.baseUnit, sku.active, sku.reorderThreshold],
    );
    inserted += res.rowCount ?? 0;
  }
  assert(inserted === 27, `first SKU insert expected 27 got ${inserted}`);

  // Idempotent replay
  let replayInserted = 0;
  for (const sku of readySkus) {
    const res = await client.query(
      `insert into public.skus (legacy_id, name, base_unit, active, reorder_threshold)
       select $1,$2,$3,$4,$5
       where not exists (select 1 from public.skus where legacy_id = $1)
       returning id`,
      [sku.legacyId, sku.name, sku.baseUnit, sku.active, sku.reorderThreshold],
    );
    replayInserted += res.rowCount ?? 0;
  }
  assert(replayInserted === 0, `idempotent replay must insert 0, got ${replayInserted}`);
  const skuTotal = await client.query<{ n: number }>(`select count(*)::int as n from public.skus`);
  assert(skuTotal.rows[0].n === 27, "sku total drifted after replay");

  // Conflict: preexisting visit with a legacy_id that an ADD wants — do not overwrite
  const conflictLegacy = preview.addCandidates.find((d) => d.tab === "ServiceSessions")!.legacyId;
  const victim = seed.visits[0];
  await client.query(`update public.service_sessions set legacy_id = $1, notes = 'must-keep' where id = $2`, [
    conflictLegacy,
    victim.id,
  ]);
  const conflictExists = await client.query<{ notes: string }>(
    `select notes from public.service_sessions where legacy_id = $1`,
    [conflictLegacy],
  );
  assert(conflictExists.rows[0]?.notes === "must-keep", "conflict setup failed");
  // Attempted "apply" of ADD visit without maps → blocked; with fabricated insert attempt against existing legacy_id → preserve
  const wouldInsert = await client.query(
    `insert into public.service_sessions (
       id, site_id, person_id, service_date, status, start_at, is_sandbox, legacy_id, checklist_snapshot
     )
     select gen_random_uuid(), $1, $2, current_date, 'completed', now(), false, $3, '{}'::jsonb
     where not exists (select 1 from public.service_sessions where legacy_id = $3)
     returning id`,
    [victim.site_id, victim.person_id, conflictLegacy],
  );
  assert((wouldInsert.rowCount ?? 0) === 0, "conflicting visit insert should be skipped");
  const preserved = await client.query<{ notes: string; id: string }>(
    `select id::text as id, notes from public.service_sessions where legacy_id = $1`,
    [conflictLegacy],
  );
  assert(preserved.rows[0].id === victim.id && preserved.rows[0].notes === "must-keep", "preexisting visit overwritten");

  // Payment preserved
  const payAfter = await client.query<{ amount: string }>(`select amount::text as amount from public.payments where id = $1`, [
    payId,
  ]);
  assert(payAfter.rows[0].amount === beforePay.rows[0].amount, "payment amount changed");

  const visitsAfter = await client.query<{ n: number }>(`select count(*)::int as n from public.service_sessions`);
  assert(visitsAfter.rows[0].n === beforeVisits.rows[0].n, "visit count changed unexpectedly");

  // RLS: non-admin authenticated cannot insert skus
  let rlsDenied = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [seed.people.find((p) => p.role === "tech")?.id ?? seed.people[0].id]);
    await client.query(`insert into public.skus (legacy_id, name) values ('rls-probe','should-fail')`);
    await client.query("COMMIT");
  } catch (err) {
    rlsDenied = /policy|permission|violates/i.test(String(err));
    await client.query("ROLLBACK").catch(() => undefined);
  }
  assert(rlsDenied, "expected RLS to deny non-admin sku insert");

  // Admin authenticated can insert (restore path uses table owner; prove admin policy allows)
  let adminOk = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [adminId]);
    const ins = await client.query(
      `insert into public.skus (legacy_id, name) values ('admin-probe','ok') returning id`,
    );
    adminOk = (ins.rowCount ?? 0) === 1;
    await client.query("ROLLBACK"); // don't keep probe
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
  assert(adminOk, "admin authenticated should insert skus under RLS");

  // Backup/restore of SKU set: capture legacy_ids, delete, restore from backup list
  const backup = await client.query<{ legacy_id: string; name: string; base_unit: string | null; active: boolean; reorder_threshold: string | null }>(
    `select legacy_id, name, base_unit, active, reorder_threshold::text from public.skus where legacy_id is not null order by legacy_id`,
  );
  await client.query(`delete from public.skus where legacy_id is not null`);
  const cleared = await client.query<{ n: number }>(`select count(*)::int as n from public.skus`);
  assert(cleared.rows[0].n === 0, "sku delete for restore probe failed");
  for (const row of backup.rows) {
    await client.query(
      `insert into public.skus (legacy_id, name, base_unit, active, reorder_threshold)
       values ($1,$2,$3,$4,$5)`,
      [row.legacy_id, row.name, row.base_unit, row.active, row.reorder_threshold],
    );
  }
  const restored = await client.query<{ n: number }>(`select count(*)::int as n from public.skus`);
  assert(restored.rows[0].n === backup.rows.length, "sku backup restore count mismatch");

  // Visit fingerprints after all probes (ignore the temporary legacy_id conflict tag — restore original nulls)
  await client.query(`update public.service_sessions set legacy_id = null, notes = null where id = $1`, [victim.id]);
  // re-apply original legacy_ids from seed
  for (const visit of seed.visits) {
    await client.query(`update public.service_sessions set legacy_id = $1 where id = $2`, [visit.legacy_id, visit.id]);
  }
  const afterVisitFp = await client.query<{ fp: string }>(
    `select string_agg(id::text || ':' || coalesce(legacy_id,'') || ':' || status, '|' order by id) as fp from public.service_sessions`,
  );
  assert(afterVisitFp.rows[0].fp === beforeVisitFp.rows[0].fp, "visit fingerprints changed");

  // Blocked visit attempt without maps must stay blocked (count of blocked reports)
  const visitBlocked = reports.filter((r) => r.tab === "ServiceSessions" && r.readiness === "blocked_pending_decision").length;
  assert(visitBlocked === 234, `expected 234 visit ADDs blocked without maps, got ${visitBlocked}`);

  const machine = {
    result: "PASS",
    limitation: SQL_LOCAL_LIMITATION,
    hostedWrites: 0,
    engine: "PostgreSQL 16 local",
    databaseName: dbName,
    priorJsonPreview: {
      artifact: "/opt/cursor/artifacts/private-transfer-preview-2026-11-08/TRANSFER-PREVIEW.md",
      KEEP: 16,
      ADD: 669,
      REVIEW: 309,
      EXCLUDED: 0,
      reusedNotRerunAsAuthority: true,
    },
    zipSha256: zipSha,
    migrationsLoaded: base,
    notLoaded: ["0011", "0012", "0013", "0014", "0015"],
    sqlReadiness: summary,
    tested: {
      seedKeepVisits: seed.visits.length,
      seedKeepPeople: seed.people.length,
      seedKeepSites: seed.sites.length,
      skuFirstInsert: inserted,
      skuReplayInsert: replayInserted,
      skuRollbackClearsBatch: true,
      skuBackupRestore: true,
      preexistingVisitConflictSkipped: true,
      paymentPreserved: true,
      visitFingerprintsUnchanged: true,
      rlsNonAdminSkuInsertDenied: true,
      rlsAdminSkuInsertAllowed: true,
      schemaReadyAppliedTabs: ["SKUs"],
      blockedWithoutMapping: ["ServiceSessions", "LocationSKUs", "KioskFlags", "ScheduleOverrides"],
      withheldSeparate: ["Transactions", "Payments", "Charges", "People", "Locations", "Config", "ServiceSessions:repeats"],
    },
    notTested: [
      "hosted Supabase apply",
      "live import activation",
      "Google/Drive",
      "Netlify publish",
      "fabricated person/site identity maps",
      "stock/pay reconciliation balances",
      "unmatched worker login/access",
    ],
    smallestDecisionsBeforeMoreSql: summary.smallestDecisions,
    transferReadyClaim: false,
    acMappingEvidence: {
      denominator: 163,
      confirmed_source_built_lower_bound: 8,
      confirmed_source_built_lower_bound_percent: 4.9,
      current_live_verified: 0,
      note: "8/163 is documentation floor / strict reviewed source only — not actual completion. This SQL gate adds local evidence toward History transfer checks but does not flip live-verified.",
      relatedChecksTouchedLocally: ["AC145", "AC146", "AC147", "AC148", "AC149"],
      relatedChecksStillNotMet: ["AC146", "AC150", "AC151", "AC153", "AC155"],
    },
  };

  const md = [
    "# Private transfer — local PostgreSQL SQL/RLS/restore gate",
    "",
    `**Result: PASS** (local only). ${SQL_LOCAL_LIMITATION}`,
    "",
    "## User / admin value",
    "",
    "- Admins get **proof of which ADD rows can hit real Postgres schema without inventing identity maps**, plus idempotent SKU apply, conflict non-overwrite, RLS admin gate, and rollback/restore for the ready subset.",
    "- Unresolved stock/pay/repeats/unmatched-worker history stay **withheld** — not silently loaded.",
    "",
    "## Prior JSON preview (reused, not re-audited)",
    "",
    `- Artifact: \`/opt/cursor/artifacts/private-transfer-preview-2026-11-08/TRANSFER-PREVIEW.md\``,
    `- KEEP **16** / ADD **669** / REVIEW **309** / EXCLUDED **0** (c59ef4a path).`,
    "",
    "## SQL readiness (no fabricated maps)",
    "",
    `- ready: **${summary.ready}** (SKU catalogue ADD only)`,
    `- blocked_pending_decision: **${summary.blocked_pending_decision}**`,
    `- withheld_review: **${summary.withheld_review}**`,
    `- excluded: **${summary.excluded}**`,
    "",
    "### Smallest decisions required before more SQL",
    ...summary.smallestDecisions.map((d) => `- ${d}`),
    "",
    "## Tested",
    "",
    `- Seeded KEEP visits/people/sites from sanitized current snapshot; visit fingerprints unchanged after probes.`,
    `- SKU ADD first insert **${inserted}**, replay insert **${replayInserted}** (must be 0).`,
    `- Transaction ROLLBACK cleared SKU batch; backup delete/restore restored **${backup.rows.length}** SKUs.`,
    `- Conflicting visit legacy_id skip preserved notes=\`must-keep\`; seeded payment preserved.`,
    `- RLS: non-admin authenticated SKU insert denied; admin allowed.`,
    "",
    "## Not tested / not claimed",
    "",
    ...machine.notTested.map((x) => `- ${x}`),
    "",
    "- **Not transfer-ready.** Local schema-ready subset only.",
    "",
    "## 163-check mapping (honest)",
    "",
    `- Strict confirmed source-built floor: **8 / 163 (4.9%)** — documentation floor, not actual completion.`,
    `- Live verified: **0 / 163**.`,
    `- This work supports local History transfer evidence (AC145/147–149 adjacent) but **does not** satisfy AC146 live import or AC150–155 cutover drills.`,
    "",
    "## Netlify",
    "",
    "- Paid Netlify / publish remains **blocked** pending Support ticket; no sends from this run.",
    "",
  ].join("\n");

  writeFileSync(resolve(outDir, "TRANSFER-SQL-LOCAL-GATE.md"), md);
  writeFileSync(resolve(outDir, "transfer-sql-local-machine.json"), JSON.stringify(machine, null, 2));
  writeFileSync(
    resolve(outDir, "RUN-EVIDENCE.txt"),
    [
      "result=PASS",
      "hostedWrites=0",
      "engine=PostgreSQL16",
      `db=${dbName}`,
      "priorKEEP=16",
      "priorADD=669",
      "priorREVIEW=309",
      `sqlReady=${summary.ready}`,
      `sqlBlocked=${summary.blocked_pending_decision}`,
      `skuInsert=${inserted}`,
      `skuReplay=${replayInserted}`,
      "transferReadyClaim=false",
      `zipSha256=${zipSha}`,
      "",
    ].join("\n"),
  );
  // sanitized readiness by tab only (no PII)
  writeFileSync(
    resolve(outDir, "sql-readiness-by-tab.json"),
    JSON.stringify({ byTab: summary.byTab, smallestDecisions: summary.smallestDecisions }, null, 2),
  );

  for (const name of [
    "TRANSFER-SQL-LOCAL-GATE.md",
    "transfer-sql-local-machine.json",
    "RUN-EVIDENCE.txt",
    "sql-readiness-by-tab.json",
  ]) {
    writeFileSync(resolve(privateOut, name), readFileSync(resolve(outDir, name)));
  }

  await client.end();
  console.log(JSON.stringify({ result: "PASS", outDir, summary, inserted, replayInserted }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
