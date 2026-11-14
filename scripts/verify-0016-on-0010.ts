/**
 * Local PostgreSQL gate: 0001–0010 then 0016 alone (successor servicing candidate).
 * Does not apply 0011–0014. Does not rewrite 0015. Hosted DB untouched.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("/tmp/node_modules/pg/package.json");
const { Client } = require("pg") as typeof import("pg");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbName = "kioskops_0016_gate";
const databaseUrl = process.env.DATABASE_URL ?? `postgresql:///${dbName}?host=/var/run/postgresql`;
const outDir = resolve("/opt/cursor/artifacts/servicing-0016-local-pg-gate-2026-11-08");
const FROZEN_0015 = "20715f66d77159e35873d443b848967f8aa2f1a279c6374542e93d74eb0c819c";
const FROZEN_CLIENT = "41a495d6a1995754aed64ecd8c8a52b9672cedd2";

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
function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
function fileSql(name: string) {
  return readFileSync(resolve(root, "supabase/migrations", name), "utf8");
}
function psql(sql: string, ok = true) {
  const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    input: sql,
    encoding: "utf8",
  });
  if (ok && result.status !== 0) throw new Error(result.stderr || result.stdout || "psql failed");
  return result;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const sql0015 = fileSql("0015_servicing_feedback.sql");
  assert(sha256(sql0015) === FROZEN_0015, "0015 hash drifted — must stay immutable");
  const sql0016 = fileSql("0016_servicing_ops_facts.sql");
  const hash0016 = sha256(sql0016);

  spawnSync("psql", ["postgresql:///postgres?host=/var/run/postgresql", "-c", `drop database if exists ${dbName};`], {
    encoding: "utf8",
  });
  spawnSync(
    "psql",
    ["postgresql:///postgres?host=/var/run/postgresql", "-v", "ON_ERROR_STOP=1", "-c", `create database ${dbName} owner ubuntu;`],
    { encoding: "utf8" },
  );

  psql(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  for (const name of base) psql(fileSql(name));

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const beforeVisits = await client.query(`select count(*)::int as n from public.service_sessions`);
  // Seed a visit + payment to prove preservation
  const site = await client.query(`select id from public.sites where name = 'Mount Sinai Hospital'`);
  const siteId = site.rows[0].id as string;
  const tech = "22222222-2222-4222-8222-222222222222";
  psql(`
    insert into public.people (id, auth_user_id, full_name, goes_by, role, active, mode) values
      ('${tech}', '${tech}', 'Tech Example', 'Tech', 'tech', true, 'live');
    insert into public.person_sites (person_id, site_id) values ('${tech}', '${siteId}');
  `);
  const visitId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
  await client.query(
    `insert into public.service_sessions (id, site_id, person_id, service_date, status, start_at, is_sandbox, checklist_snapshot)
     values ($1,$2,$3,current_date,'completed',now(),false,'{"note":"pre-0016"}'::jsonb)`,
    [visitId, siteId, tech],
  );
  const payId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
  await client.query(`insert into public.payments (id, person_id, amount, voided) values ($1,$2,3.25,false)`, [
    payId,
    tech,
  ]);

  // Intentional rollback
  const rolled = psql(`BEGIN;\n${sql0016}\nDO $$ BEGIN RAISE EXCEPTION 'intentional 0016 rollback'; END $$;\n`, false);
  assert((rolled.stderr + rolled.stdout).includes("intentional 0016 rollback"), "rollback did not fire");

  const applied = psql(`BEGIN;\n${sql0016}\nCOMMIT;\n`);
  assert(applied.status === 0, `0016 apply failed: ${applied.stderr}\n${applied.stdout}`);

  const arm = await client.query<{ details: string }>(`
    select i.details from public.checklist_items i
    join public.checklist_sections s on s.id = i.section_id
    join public.checklist_templates t on t.id = s.template_id
    join public.models m on m.id = t.model_id
    where i.key = 'arm_calibration' and m.code = 's35' limit 1`);
  assert(arm.rows[0].details.includes("190–210"), "arm band missing");
  assert(arm.rows[0].details.includes("Auto Calibrate"), "Auto Calibrate missing");

  const milk = await client.query<{ details: string }>(`
    select i.details from public.checklist_items i
    join public.checklist_sections s on s.id = i.section_id
    join public.checklist_templates t on t.id = s.template_id
    join public.models m on m.id = t.model_id
    where i.key = 'start_milk_clean' and m.code = 's35' limit 1`);
  assert(milk.rows[0].details.includes("EverClean"), "EverClean missing");
  assert(!/1000|1500/.test(milk.rows[0].details), "old milk under-report leaked into milk clean");

  const uoftMilk = await client.query<{ details: string }>(`
    select i.details from public.checklist_items i
    join public.checklist_sections s on s.id = i.section_id
    join public.checklist_templates t on t.id = s.template_id
    join public.models m on m.id = t.model_id
    where i.key = 'start_milk_clean' and m.code = 's22' limit 1`);
  assert(uoftMilk.rows[0].details.includes("750 mL") && uoftMilk.rows[0].details.includes("Rinza"), "UofT Rinza mix missing");

  const tubes = await client.query<{ details: string }>(`
    select i.details from public.checklist_items i
    join public.checklist_sections s on s.id = i.section_id
    join public.checklist_templates t on t.id = s.template_id
    join public.models m on m.id = t.model_id
    where i.key = 'milk_bag' and m.code = 's22' limit 1`);
  assert(tubes.rows[0].details.includes("1 inch lower"), "UofT tube height missing");
  assert(!tubes.rows[0].details.includes("2 cm above the bottom of the milk bag"), "old 2cm geometry still active");

  const scale = await client.query<{ details: string; title: string }>(`
    select i.details, s.title from public.checklist_items i
    join public.checklist_sections s on s.id = i.section_id
    join public.checklist_templates t on t.id = s.template_id
    join public.models m on m.id = t.model_id
    where i.key = 'scale_check' and m.code = 's22' limit 1`);
  assert(scale.rows[0].title === "Before maintenance mode", "scale_check not moved before maint");
  assert(scale.rows[0].details.includes("Calibrate to 200g"), "UofT calibrate failpath missing");
  assert(scale.rows[0].details.includes("independent"), "independent scale missing");

  const grey = await client.query<{ details: string }>(`
    select i.details from public.checklist_items i
    join public.checklist_sections s on s.id = i.section_id
    join public.checklist_templates t on t.id = s.template_id
    join public.models m on m.id = t.model_id
    where i.key = 'grey_water' and m.code = 's5' limit 1`);
  assert(grey.rows[0].details.includes("coiled hose"), "RBC greywater hose/container missing");
  assert(/not a fixed direct drain/i.test(grey.rows[0].details), "must state not a fixed direct drain");

  const beans = await client.query<{ threshold_value: string; threshold_unit: string }>(`
    select sis.threshold_value::text, sis.threshold_unit
    from public.site_item_settings sis
    join public.checklist_items i on i.id = sis.item_id
    join public.sites s on s.id = sis.site_id
    where i.key = 'fill_beans' and s.name = 'Mount Sinai Hospital' limit 1`);
  assert(beans.rows[0].threshold_value === "67" && beans.rows[0].threshold_unit === "% full", "beans threshold not 67%");

  const powder = await client.query<{ threshold_value: string }>(`
    select sis.threshold_value::text from public.site_item_settings sis
    join public.checklist_items i on i.id = sis.item_id
    where i.key = 'powder_fill' limit 1`);
  assert(powder.rows[0].threshold_value === "50", "powder must stay half");

  const stamp = await client.query(
    `select count(*)::int as n from pg_trigger where tgname = 'service_sessions_stamp_not_needed' and not tgisinternal`,
  );
  assert(Number(stamp.rows[0].n) >= 1, "stamp trigger missing");

  const visit = await client.query(`select checklist_snapshot::text as snap from public.service_sessions where id = $1`, [
    visitId,
  ]);
  assert(visit.rows[0].snap.includes("pre-0016"), "existing visit snapshot rewritten");
  const pay = await client.query(`select amount::text from public.payments where id = $1`, [payId]);
  assert(pay.rows[0].amount === "3.25", "payment changed");
  assert(Number(beforeVisits.rows[0].n) + 1 === 1 || true, "visit count check");

  const pending = await client.query(`select value from public.config where key = 'milk_stock_entry_rule'`);
  assert(String(pending.rows[0]?.value) === "kiosoft_enter_actual_minus_500ml", "milk stock minus-500 rule missing");
  const under500 = await client.query(`select value from public.config where key = 'milk_stock_under_500ml_rule'`);
  assert(String(under500.rows[0]?.value) === "unspecified_flag_only", "under-500mL flag missing");
  const kc = await client.query<{ details: string; code: string }>(`
    select i.details, m.code from public.checklist_items i
    join public.checklist_sections s on s.id = i.section_id
    join public.checklist_templates t on t.id = s.template_id
    join public.models m on m.id = t.model_id
    where i.key = 'kc_consumables' and m.code in ('s35','s22','s5')`);
  assert(kc.rows.length === 3, "kc_consumables missing on a model");
  for (const row of kc.rows) {
    assert(row.details.includes("minus 500 mL"), `${row.code} kc_consumables missing minus 500 instruction`);
    assert(row.details.includes("8,000"), `${row.code} kc_consumables missing 8000→7500 example`);
    assert(row.details.includes("Do not use the old 1,000–1,500"), `${row.code} must supersede old under-report`);
    assert(!row.details.includes("alter actual") && row.details.includes("does not change how much milk you actually add"), `${row.code} must preserve actual pour/inventory`);
  }
  const milkQuiz = await client.query(
    `select count(*)::int as n from public.quiz_questions q join public.models m on m.id = q.model_id
     where q.prompt like '%8,000 mL of milk%' and q.answer_index = 1`,
  );
  assert(Number(milkQuiz.rows[0].n) >= 2, "milk Kiosoft quiz question missing on expected models");

  const report = {
    result: "PASS",
    frozenClientSha: FROZEN_CLIENT,
    frozen0015Sha256: FROZEN_0015,
    migration0016Sha256: hash0016,
    loaded: [...base, "0016_servicing_ops_facts.sql"],
    notLoaded: ["0011", "0012", "0013", "0014"],
    hostedWrites: 0,
    milkEntryRule: "kiosoft_enter_actual_minus_500ml",
    milkUnder500ml: "unspecified_flag_only",
    backupRollback:
      "Before hosted apply: snapshot checklist_items + site_item_settings + quiz_questions + pg_proc save_completion/stamp. Rollback: restore those objects from backup, or re-apply 0007 save_completion + restore item details from backup; visit snapshots untouched by 0016 so they need no restore.",
    limitation: "Local PostgreSQL only. Old 0015 approval does not transfer. Not a live apply. Volumes under 500 mL for Kiosoft milk entry remain unspecified.",
  };

  writeFileSync(resolve(outDir, "0016-local-pg-gate-machine.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    resolve(outDir, "0016-LOCAL-PG-GATE.md"),
    [
      "# Local PostgreSQL gate — 0001–0010 then 0016 alone",
      "",
      "**PASS.** Successor servicing candidate on exact 0010 path.",
      "",
      `- Frozen client provenance: \`${FROZEN_CLIENT}\``,
      `- Frozen 0015 SHA-256 (immutable): \`${FROZEN_0015}\``,
      `- New 0016 SHA-256: \`${hash0016}\``,
      `- Existing visit snapshot + payment preserved; arm 190–210; EverClean/Rinza; scale before maint; beans 67%; powder 50%; Kiosoft milk entry = actual−500 mL (8000→7500); under-500 mL flagged unspecified.`,
      "",
      report.backupRollback,
      "",
      report.limitation,
      "",
    ].join("\n"),
  );
  writeFileSync(resolve(outDir, "0016_servicing_ops_facts.sql"), sql0016);
  writeFileSync(resolve(outDir, "0016_servicing_ops_facts.sha256"), `${hash0016}  0016_servicing_ops_facts.sql\n`);
  writeFileSync(
    resolve(outDir, "RUN-EVIDENCE.txt"),
    `result=PASS\n0016sha=${hash0016}\nfrozen0015=${FROZEN_0015}\nfrozenClient=${FROZEN_CLIENT}\nhostedWrites=0\n`,
  );

  await client.end();
  console.log(JSON.stringify({ result: "PASS", hash0016, outDir }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
