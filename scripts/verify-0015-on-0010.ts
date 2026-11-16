/**
 * Local PostgreSQL safety gate: migrations 0001–0010, then 0015 alone.
 * Does not connect to hosted Supabase. Does not apply 0011–0014.
 *
 *   DATABASE_URL=postgresql:///kioskops_0015_gate?host=/var/run/postgresql \
 *     npx tsx scripts/verify-0015-on-0010.ts
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  photoAuditArgMissing,
  startRequest,
  withoutPhotoArg,
  acceptStartResult,
} from "../app/src/lib/startRequest.ts";

const require = createRequire("/tmp/node_modules/pg/package.json");
const { Client } = require("pg") as typeof import("pg");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbName = "kioskops_0015_gate";
const databaseUrl =
  process.env.DATABASE_URL ?? `postgresql:///${dbName}?host=/var/run/postgresql`;
const outDir = resolve("/opt/cursor/artifacts/servicing-0015-local-pg-gate-2026-11-08");
const privateOut = resolve(
  "/cursor/stores/bc-f5297e3b-d424-5cd9-a8f4-d68a5d70cce7/private-migrate-dryrun-2026-11-08/0015-gate",
);
const EXPECTED_0015_SHA = "20715f66d77159e35873d443b848967f8aa2f1a279c6374542e93d74eb0c819c";
const CANDIDATE_CLIENT_SHA = "41a495d6a1995754aed64ecd8c8a52b9672cedd2";

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

const tech = "22222222-2222-4222-8222-222222222222";
const admin = "11111111-1111-4111-8111-111111111111";
const oldVisitId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const newVisitId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const payId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
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

function extractGuards(prosrc: string) {
  return {
    notSignedIn: /Not signed in/i.test(prosrc),
    notAllowed: /Not allowed/i.test(prosrc),
    practiceMatch: /Switch Practice mode/i.test(prosrc),
    submitted: /already submitted/i.test(prosrc),
    milkLock: /stays locked until milk cleaning finishes/i.test(prosrc),
    wipeCameoSpecial: /v_key = 'wipe_cameo'/i.test(prosrc),
    everyServiceReject: /part of every service/i.test(prosrc),
    usesCurrentPerson: /private\.current_person_id/i.test(prosrc),
    usesIsAdmin: /private\.is_admin/i.test(prosrc),
    usesInPractice: /private\.in_practice/i.test(prosrc),
    authUidOnInsert: /auth\.uid\(\)/i.test(prosrc),
  };
}

async function asUser<T>(
  client: InstanceType<typeof Client>,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const value = await fn();
    await client.query("COMMIT");
    return value;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(privateOut, { recursive: true });

  const sql0015 = fileSql("0015_servicing_feedback.sql");
  const hash0015 = sha256(sql0015);
  assert(hash0015 === EXPECTED_0015_SHA, `0015 hash mismatch: ${hash0015}`);

  const dropDb = spawnSync(
    "psql",
    ["postgresql:///postgres?host=/var/run/postgresql", "-v", "ON_ERROR_STOP=1", "-c", `drop database if exists ${dbName};`],
    { encoding: "utf8" },
  );
  assert(dropDb.status === 0, `drop db failed: ${dropDb.stderr}`);
  const createDb = spawnSync(
    "psql",
    ["postgresql:///postgres?host=/var/run/postgresql", "-v", "ON_ERROR_STOP=1", "-c", `create database ${dbName} owner ubuntu;`],
    { encoding: "utf8" },
  );
  assert(createDb.status === 0, `create db failed: ${createDb.stderr}`);

  const preamble = `
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `;
  psql(preamble);
  for (const name of base) {
    const applied = psql(fileSql(name));
    assert(applied.status === 0, `failed ${name}: ${applied.stderr}`);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const startArgsBefore = await client.query<{ pronargs: number }>(
    `select pronargs from pg_proc where proname = 'start_session' and pronamespace = 'public'::regnamespace`,
  );
  assert(startArgsBefore.rows[0]?.pronargs === 4, `expected start_session arity 4 on 0010, got ${startArgsBefore.rows[0]?.pronargs}`);

  const beforeFn = await client.query<{ prosrc: string }>(
    `select prosrc from pg_proc where proname = 'save_completion' and pronamespace = 'public'::regnamespace`,
  );
  const guards0010 = extractGuards(beforeFn.rows[0].prosrc);
  assert(guards0010.notSignedIn && guards0010.notAllowed && guards0010.practiceMatch, "0010 save_completion missing auth guards");
  assert(guards0010.milkLock && guards0010.wipeCameoSpecial, "0010 milk-lock guards missing");
  assert(!guards0010.everyServiceReject, "0010 should not yet reject every-service Not needed");

  const site = await client.query<{ id: string }>(
    `select id from public.sites where name = 'Mount Sinai Hospital'`,
  );
  assert(site.rows[0]?.id, "Sinai was not seeded");
  const siteId = site.rows[0].id;

  psql(`
    insert into public.people (id, auth_user_id, full_name, goes_by, role, active, mode) values
      ('${admin}', '${admin}', 'Admin Example', 'Admin', 'admin', true, 'live'),
      ('${tech}', '${tech}', 'Tech Example', 'Tech', 'tech', true, 'live');
    insert into public.person_sites (person_id, site_id) values
      ('${tech}', '${siteId}');
  `);

  // Older open visit without not_needed_allowed (pre-0015 insert path)
  const template = await client.query<{ template_id: string; version: number; snap: unknown }>(`
    select t.id as template_id, t.version,
      jsonb_build_object(
        'version', t.version,
        'template_id', t.id,
        'model_code', m.code,
        'milk_clean_minutes', m.milk_clean_minutes,
        'sections', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id,
            'title', s.title,
            'phase', s.phase,
            'position', s.position,
            'items', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', i.id,
                'key', i.key,
                'title', i.title,
                'details', i.details,
                'required', i.required,
                'locked_during_clean', i.locked_during_clean,
                'position', i.position
              ) order by i.position)
              from public.checklist_items i where i.section_id = s.id
            ), '[]'::jsonb)
          ) order by s.position)
          from public.checklist_sections s where s.template_id = t.id
        ), '[]'::jsonb)
      ) as snap
    from public.checklist_templates t
    join public.models m on m.id = t.model_id
    join public.sites si on si.model_id = m.id
    where si.id = '${siteId}' and t.published
    order by t.version desc
    limit 1
  `);
  assert(template.rows[0], "no published template");

  await client.query(
    `insert into public.service_sessions (
      id, site_id, person_id, template_id, template_version, checklist_snapshot,
      service_date, status, start_at, is_sandbox, created_by
    ) values ($1,$2,$3,$4,$5,$6, current_date, 'open', now(), false, null)`,
    [oldVisitId, siteId, tech, template.rows[0].template_id, template.rows[0].version, template.rows[0].snap],
  );

  await client.query(
    `insert into public.payments (id, person_id, amount, voided, is_sandbox, created_by)
     values ($1, $2, 12.50, false, false, null)`,
    [payId, tech],
  );

  const armBefore = await client.query<{ details: string }>(`
    select i.details from public.checklist_items i
    join public.checklist_sections s on s.id = i.section_id
    join public.checklist_templates t on t.id = s.template_id
    join public.models m on m.id = t.model_id
    where i.key = 'arm_calibration' and m.code = 's35' limit 1
  `);

  // Transactional apply proof: intentional rollback leaves DB at 0010
  const rolled = psql(`BEGIN;\n${sql0015}\nDO $$ BEGIN RAISE EXCEPTION 'intentional 0015 rollback'; END $$;\n`, false);
  assert(
    (rolled.stderr + rolled.stdout).includes("intentional 0015 rollback"),
    "intentional rollback did not fire",
  );
  const afterRollback = psql(
    `
    select to_regprocedure('private.stamp_visit_not_needed()') is null;
    select count(*)::int from pg_trigger where tgname = 'service_sessions_stamp_not_needed' and not tgisinternal;
    select pronargs from pg_proc where proname = 'start_session' and pronamespace = 'public'::regnamespace;
  `,
    true,
    true,
  );
  const rollLines = afterRollback.stdout.trim().split("\n").map((l) => l.trim());
  assert(rollLines[0] === "t", `stamp function remained after rollback: ${afterRollback.stdout}`);
  assert(rollLines[1] === "0", `stamp trigger remained after rollback: ${afterRollback.stdout}`);
  assert(rollLines[2] === "4", `start_session arity changed during aborted 0015: ${afterRollback.stdout}`);

  // Commit 0015 alone
  const applied = psql(`BEGIN;\n${sql0015}\nCOMMIT;\n`);
  assert(applied.status === 0, `0015 apply failed: ${applied.stderr}\n${applied.stdout}`);

  const afterFn = await client.query<{ prosrc: string }>(
    `select prosrc from pg_proc where proname = 'save_completion' and pronamespace = 'public'::regnamespace`,
  );
  const guards0015 = extractGuards(afterFn.rows[0].prosrc);
  assert(guards0015.notSignedIn && guards0015.notAllowed && guards0015.practiceMatch, "0015 weakened auth guards");
  assert(guards0015.milkLock && guards0015.wipeCameoSpecial, "0015 lost milk-lock / wipe_cameo behavior");
  assert(guards0015.everyServiceReject, "0015 missing every-service Not needed reject");
  assert(guards0015.usesCurrentPerson && guards0015.usesIsAdmin && guards0015.usesInPractice, "0015 missing private ACL helpers");
  assert(guards0015.authUidOnInsert, "0015 lost auth.uid() on insert path");

  // No weakening: every 0010 auth/access guard still present
  for (const key of ["notSignedIn", "notAllowed", "practiceMatch", "submitted", "milkLock", "wipeCameoSpecial", "usesCurrentPerson", "usesIsAdmin", "usesInPractice"] as const) {
    assert(guards0010[key] === false || guards0015[key] === true, `guard weakened: ${key}`);
  }

  const startArgsAfter = await client.query<{ pronargs: number; oid: string }>(`
    select pronargs, oid::text from pg_proc
    where proname = 'start_session' and pronamespace = 'public'::regnamespace
  `);
  assert(startArgsAfter.rows.length === 1, `expected exactly one start_session overload, got ${startArgsAfter.rows.length}`);
  assert(startArgsAfter.rows[0].pronargs === 4, "start_session arity changed after 0015 (should stay 4 on 0010 path)");

  // Client/start fallback: 4-arg path works; 5-arg photo arg is absent (matches photoAuditArgMissing)
  const fiveArgMissing = await client.query<{ exists: boolean }>(`
    select to_regprocedure('public.start_session(uuid,uuid,timestamptz,boolean,boolean)') is not null as exists
  `);
  assert(fiveArgMissing.rows[0].exists === false, "5-arg start_session should not exist on 0010+0015 path");
  const asked = startRequest({
    id: "ffffffff-ffff-4fff-8fff-fffffffffff0",
    siteId,
    start: "2026-11-08T12:00:00Z",
    estimated: false,
    photoAudit: true,
  });
  assert("p_photo_audit" in asked, "client still sends p_photo_audit when photoAudit requested");
  const stripped = withoutPhotoArg(asked);
  assert(!("p_photo_audit" in stripped), "withoutPhotoArg must drop p_photo_audit");
  assert(
    photoAuditArgMissing({
      code: "PGRST202",
      message: "Could not find the function public.start_session(p_id, p_photo_audit) in the schema cache",
    }),
    "photoAuditArgMissing should detect 0010-shaped servers",
  );

  const trigger = await client.query<{ n: number }>(`
    select count(*)::int as n from pg_trigger where tgname = 'service_sessions_stamp_not_needed' and not tgisinternal
  `);
  assert(trigger.rows[0].n >= 1, "stamp trigger missing");

  const stampPerm = await client.query<{ auth_exec: boolean }>(`
    select has_function_privilege('authenticated', 'private.stamp_visit_not_needed()', 'execute') as auth_exec
  `);
  assert(stampPerm.rows[0].auth_exec === false, "stamp_visit_not_needed should not be executable by authenticated");

  const savePerm = await client.query<{ auth_exec: boolean }>(`
    select has_function_privilege('authenticated', 'public.save_completion(uuid,uuid,text,text,text,text,integer,uuid,text)', 'execute') as auth_exec
  `);
  assert(savePerm.rows[0].auth_exec === true, "authenticated lost execute on save_completion");

  const armAfter = await client.query<{ title: string; details: string }>(`
    select i.title, i.details from public.checklist_items i
    join public.checklist_sections s on s.id = i.section_id
    join public.checklist_templates t on t.id = s.template_id
    join public.models m on m.id = t.model_id
    where i.key = 'arm_calibration' and m.code = 's35' limit 1
  `);
  const details = String(armAfter.rows[0]?.details ?? "");
  assert(details.includes("Auto Calibrate"), "Auto Calibrate missing from template UPDATE");
  assert(details.includes("190–210") || details.includes("190-210"), "190–210 g range missing");
  assert(/1\.\s*On the order tablet/.test(details), "step 1 missing");
  assert(details.includes("not the cup presence sensor"), "cup-sensor distinction missing");
  const stepNums = [...details.matchAll(/^(\d+)\./gm)].map((m) => m[1]);
  assert(stepNums.slice(0, 7).join(",") === "1,2,3,4,5,6,7", `expected steps 1-7, got ${stepNums.slice(0, 7)}`);

  // Older visit snapshot unchanged
  const oldVisit = await client.query<{ checklist_snapshot: unknown; person_id: string }>(
    `select checklist_snapshot, person_id from public.service_sessions where id = $1`,
    [oldVisitId],
  );
  const oldText = JSON.stringify(oldVisit.rows[0].checklist_snapshot);
  assert(!oldText.includes("not_needed_allowed"), "older visit snapshot was rewritten");
  assert(oldVisit.rows[0].person_id === tech, "seeded session ownership changed");

  // Older snapshot still allows Not needed on gloves (flag absent)
  const oldGloves = await client.query<{ id: string }>(
    `
    select item->>'id' as id
    from public.service_sessions ss
    cross join lateral jsonb_array_elements(coalesce(ss.checklist_snapshot->'sections','[]'::jsonb)) sec
    cross join lateral jsonb_array_elements(coalesce(sec->'items','[]'::jsonb)) item
    where ss.id = $1 and item->>'key' = 'gloves' limit 1
  `,
    [oldVisitId],
  );
  await asUser(client, tech, async () => {
    await client.query(
      `select public.save_completion($1,$2,'not_needed',null,'',null,1,$3,'gloves')`,
      [oldVisitId, oldGloves.rows[0].id, "ffffffff-ffff-4fff-8fff-fffffffffff2"],
    );
  });
  const oldCompletion = await client.query<{ state: string }>(
    `select state from public.service_item_completions where session_id = $1 and item_id = $2`,
    [oldVisitId, oldGloves.rows[0].id],
  );
  assert(oldCompletion.rows[0]?.state === "not_needed", "older/offline-style snapshot lost Not needed allowance");

  // Free the one-open-visit slot, then start a new stamped visit (old row preserved as completed)
  await client.query(`update public.service_sessions set status = 'completed', end_at = now(), submitted_at = now() where id = $1`, [
    oldVisitId,
  ]);

  const started = await asUser(client, tech, async () => {
    const result = await client.query<{ row: { id: string; person_id: string; checklist_snapshot: Record<string, unknown> } }>(
      `select public.start_session($1::uuid, $2::uuid, now(), false) as row`,
      [newVisitId, siteId],
    );
    return result.rows[0].row;
  });
  assert(started.person_id === tech, "new visit ownership mismatch");
  assert(JSON.stringify(started.checklist_snapshot).includes("not_needed_allowed"), "new visit missing not_needed_allowed stamp");
  assert(
    acceptStartResult(true, started),
    "acceptStartResult should accept grandfathered 0010 snapshots without photo_audit block",
  );

  const gloves = await client.query<{ id: string }>(
    `
    select item->>'id' as id
    from jsonb_array_elements(coalesce($1::jsonb->'sections','[]'::jsonb)) sec
    cross join lateral jsonb_array_elements(coalesce(sec->'items','[]'::jsonb)) item
    where item->>'key' = 'gloves' limit 1
  `,
    [started.checklist_snapshot],
  );
  assert(gloves.rows[0]?.id, "gloves item missing in new snapshot");

  let rejected = false;
  let rejectMessage = "";
  try {
    await asUser(client, tech, async () => {
      await client.query(
        `select public.save_completion($1,$2,'not_needed',null,'',null,1,$3,'gloves')`,
        [started.id, gloves.rows[0].id, "ffffffff-ffff-4fff-8fff-fffffffffff1"],
      );
    });
  } catch (err) {
    rejectMessage = err instanceof Error ? err.message : String(err);
    rejected = /every service/i.test(rejectMessage);
  }
  assert(rejected, `required Not needed was not rejected on new visit: ${rejectMessage}`);

  // Payments + sessions preserved
  const payCount = await client.query<{ n: number }>(`select count(*)::int as n from public.payments where id = $1`, [payId]);
  assert(payCount.rows[0].n === 1, "seeded payment missing after 0015");
  const sessionsRemain = await client.query<{ n: number }>(
    `select count(*)::int as n from public.service_sessions where id = $1`,
    [oldVisitId],
  );
  assert(sessionsRemain.rows[0].n === 1, "seeded session missing after 0015");
  const oldSnapAfter = await client.query<{ snap: string }>(
    `select checklist_snapshot::text as snap from public.service_sessions where id = $1`,
    [oldVisitId],
  );
  assert(!oldSnapAfter.rows[0].snap.includes("not_needed_allowed"), "completing old visit rewrote its snapshot stamps");

  // Function restore path: re-apply 0007 save_completion restores pre-0015 completion rules
  const restore = psql(fileSql("0007_milk_lock_not_needed.sql"));
  assert(restore.status === 0, `restore 0007 failed: ${restore.stderr}`);
  const restoredFn = await client.query<{ prosrc: string }>(
    `select prosrc from pg_proc where proname = 'save_completion' and pronamespace = 'public'::regnamespace`,
  );
  const guardsRestored = extractGuards(restoredFn.rows[0].prosrc);
  assert(!guardsRestored.everyServiceReject, "0007 restore did not remove every-service reject");
  assert(guardsRestored.notSignedIn && guardsRestored.notAllowed, "0007 restore lost auth guards");

  const armStill = await client.query<{ details: string }>(`
    select i.details from public.checklist_items i
    join public.checklist_sections s on s.id = i.section_id
    join public.checklist_templates t on t.id = s.template_id
    join public.models m on m.id = t.model_id
    where i.key = 'arm_calibration' and m.code = 's35' limit 1
  `);
  assert(String(armStill.rows[0].details).includes("Auto Calibrate"), "template text lost during function restore");

  // Re-apply 0015 to leave gate DB in verified 0015 state
  const reapply = psql(`BEGIN;\n${sql0015}\nCOMMIT;\n`);
  assert(reapply.status === 0, `re-apply 0015 failed: ${reapply.stderr}`);

  // Backup recovery of template text: capture then reverse one field and restore from captured SQL
  const backupDetails = details;
  await client.query(
    `update public.checklist_items i
     set details = 'BACKUP_PROBE'
     from public.checklist_sections s
     join public.checklist_templates t on t.id = s.template_id
     join public.models m on m.id = t.model_id
     where i.section_id = s.id and i.key = 'arm_calibration' and m.code = 's35'`,
  );
  await client.query(
    `update public.checklist_items i
     set details = $1
     from public.checklist_sections s
     join public.checklist_templates t on t.id = s.template_id
     join public.models m on m.id = t.model_id
     where i.section_id = s.id and i.key = 'arm_calibration' and m.code = 's35'`,
    [backupDetails],
  );
  const restoredDetails = await client.query<{ details: string }>(`
    select i.details from public.checklist_items i
    join public.checklist_sections s on s.id = i.section_id
    join public.checklist_templates t on t.id = s.template_id
    join public.models m on m.id = t.model_id
    where i.key = 'arm_calibration' and m.code = 's35' limit 1
  `);
  assert(restoredDetails.rows[0].details === backupDetails, "template backup restore failed");
  assert(restoredDetails.rows[0].details.includes("Auto Calibrate"), "restored template lost Auto Calibrate");

  // Trigger backup: drop + recreate via 0015 re-apply fragment
  psql(`drop trigger if exists service_sessions_stamp_not_needed on public.service_sessions;`);
  const trgGone = psql(
    `select count(*)::int from pg_trigger where tgname = 'service_sessions_stamp_not_needed' and not tgisinternal;`,
    true,
    true,
  );
  assert(trgGone.stdout.trim() === "0", "trigger drop failed");
  psql(`
    create trigger service_sessions_stamp_not_needed
      before insert on public.service_sessions
      for each row execute function private.stamp_visit_not_needed();
  `);
  const trgBack = psql(
    `select count(*)::int from pg_trigger where tgname = 'service_sessions_stamp_not_needed' and not tgisinternal;`,
    true,
    true,
  );
  assert(trgBack.stdout.trim() === "1", "trigger restore failed");

  const payAfter = await client.query<{ n: number }>(`select count(*)::int as n from public.payments where id = $1`, [payId]);
  assert(payAfter.rows[0].n === 1, "payment lost during backup/restore probes");

  const report = {
    result: "PASS",
    engine: "PostgreSQL 16 local",
    databaseUrlHost: "/var/run/postgresql",
    databaseName: dbName,
    candidateClientSha: CANDIDATE_CLIENT_SHA,
    migration0015File: "supabase/migrations/0015_servicing_feedback.sql",
    migration0015Sha256: hash0015,
    loaded: [...base, "0015_servicing_feedback.sql"],
    notLoaded: [
      "0011_ops_batch.sql",
      "0012_photo_audit_grandfather.sql",
      "0013_preview_relay_guards.sql",
      "0014_atomic_photo_relay.sql",
    ],
    hostedWrites: 0,
    checks: {
      start_session_arity_before_after: { before: 4, after: 4 },
      start_session_overloads: 1,
      five_arg_start_session_absent: true,
      client_photo_arg_fallback_helpers: true,
      auth_guards_not_weakened: true,
      milk_lock_preserved: true,
      stamp_trigger_present: true,
      stamp_not_executable_by_authenticated: true,
      save_completion_executable_by_authenticated: true,
      auto_calibrate_seven_steps: true,
      auto_calibrate_cup_sensor_distinction: true,
      older_snapshot_not_rewritten: true,
      older_snapshot_allows_not_needed: true,
      new_visit_rejects_required_not_needed: true,
      new_visit_ownership_matches_jwt: true,
      intentional_rollback_clears_0015_objects: true,
      function_restore_via_0007_works: true,
      template_text_survives_function_restore: true,
      template_backup_restore_works: true,
      trigger_drop_recreate_works: true,
      seeded_session_preserved: true,
      seeded_payment_preserved: true,
      arm_details_before_length: String(armBefore.rows[0]?.details ?? "").length,
      arm_details_after_preview: details.slice(0, 280),
      guards0010,
      guards0015,
    },
    limitation:
      "Local PostgreSQL gate only. Hosted project was not touched. Stronger than PGlite/mock unit coverage; still not a live production apply.",
  };

  const md = [
    "# Local PostgreSQL gate — 0001–0010 then 0015 alone",
    "",
    `**Result: ${report.result}** on ${report.engine} database \`${dbName}\`.`,
    "",
    `- Client candidate SHA: \`${report.candidateClientSha}\``,
    `- 0015 file: \`${report.migration0015File}\``,
    `- 0015 SHA-256: \`${report.migration0015Sha256}\``,
    `- Loaded: ${report.loaded.join(", ")}`,
    `- Explicitly NOT loaded: ${report.notLoaded.join(", ")}`,
    `- Hosted writes: ${report.hostedWrites}`,
    "",
    "## Proven",
    "",
    "- Intentional transaction rollback of 0015 left no stamp function/trigger; `start_session` stayed 4-arg (0010 state).",
    "- Committed 0015: trigger `service_sessions_stamp_not_needed` present; still exactly one 4-arg `start_session` (no 0011–14).",
    "- Client start fallback helpers: `photoAuditArgMissing` / `withoutPhotoArg` / `acceptStartResult` still correct for 0010-shaped servers.",
    "- `save_completion` auth/access/practice/milk-lock guards retained vs 0010; every-service Not needed reject added (not a weakening).",
    "- `private.stamp_visit_not_needed` not executable by `authenticated`; `save_completion` still is.",
    "- Template `arm_calibration` UPDATE contains steps 1–7 Auto Calibrate and cup-sensor distinction.",
    "- Older open visit snapshot unchanged (no `not_needed_allowed`); Not needed still accepted on it.",
    "- New visit stamped + owned by JWT tech; Not needed on `gloves` rejected.",
    "- Seeded session + payment preserved through apply and backup/restore probes.",
    "- Function rollback via re-applying `0007` works; template Auto Calibrate text survives; template text + trigger can be restored from backup; 0015 re-applied cleanly.",
    "",
    "## Limitation",
    "",
    report.limitation,
    "",
    "## Artifact files",
    "",
    `- \`/opt/cursor/artifacts/servicing-0015-local-pg-gate-2026-11-08/0015-LOCAL-PG-GATE.md\``,
    `- \`/opt/cursor/artifacts/servicing-0015-local-pg-gate-2026-11-08/0015-local-pg-gate-machine.json\``,
    `- \`/opt/cursor/artifacts/servicing-0015-local-pg-gate-2026-11-08/RUN-EVIDENCE.txt\``,
    `- \`/opt/cursor/artifacts/servicing-0015-local-pg-gate-2026-11-08/0015_servicing_feedback.sql\``,
    `- \`/opt/cursor/artifacts/servicing-0015-local-pg-gate-2026-11-08/0015_servicing_feedback.sha256\``,
    "",
  ].join("\n");

  writeFileSync(resolve(outDir, "0015-LOCAL-PG-GATE.md"), md);
  writeFileSync(resolve(outDir, "0015-local-pg-gate-machine.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    resolve(outDir, "RUN-EVIDENCE.txt"),
    [
      "result=PASS",
      "engine=PostgreSQL16",
      `db=${dbName}`,
      `0015sha=${hash0015}`,
      `clientSha=${CANDIDATE_CLIENT_SHA}`,
      "hostedWrites=0",
      "notLoaded=0011,0012,0013,0014",
      "",
    ].join("\n"),
  );
  writeFileSync(resolve(outDir, "0015_servicing_feedback.sql"), sql0015);
  writeFileSync(resolve(outDir, "0015_servicing_feedback.sha256"), `${hash0015}  0015_servicing_feedback.sql\n`);

  for (const name of [
    "0015-LOCAL-PG-GATE.md",
    "0015-local-pg-gate-machine.json",
    "RUN-EVIDENCE.txt",
    "0015_servicing_feedback.sql",
    "0015_servicing_feedback.sha256",
  ]) {
    copyFileSync(resolve(outDir, name), resolve(privateOut, name));
  }

  await client.end();
  console.log(JSON.stringify({ result: "PASS", outDir, hash0015, privateOut, candidateClientSha: CANDIDATE_CLIENT_SHA }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
