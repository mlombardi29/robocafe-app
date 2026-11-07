/**
 * Applies the migrations to an in-process Postgres and checks RLS.
 * Does not touch the hosted project.
 *
 * Run: cd app && npx tsx ../scripts/rls-test.ts
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ADMIN = "11111111-1111-4111-8111-111111111111";
const TECH = "22222222-2222-4222-8222-222222222222";
const TRAINEE = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

async function main() {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  for (const file of [
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
    "0011_ops_batch.sql",
  ]) {
    const sql = readFileSync(resolve(root, "supabase/migrations", file), "utf8");
    await db.exec(sql);
  }

  const live = await db.query<{ id: string }>(
    "select id from public.sites where name = 'Mount Sinai Hospital'",
  );
  const practice = await db.query<{ id: string }>(
    "select id from public.sites where name like 'PRACTICE%' and cadence = 'daily'",
  );
  const sinai = live.rows[0].id;
  const practiceSinai = practice.rows[0].id;

  await db.exec(`
    insert into public.people (id, auth_user_id, full_name, goes_by, role, active, mode) values
      ('${ADMIN}', '${ADMIN}', 'Admin Example', 'Admin', 'admin', true, 'live'),
      ('${TECH}', '${TECH}', 'Tech Example', 'Tech', 'tech', true, 'live'),
      ('${TRAINEE}', '${TRAINEE}', 'Trainee Example', 'Trainee', 'trainee', true, 'live'),
      ('${OTHER}', '${OTHER}', 'Other Example', 'Other', 'tech', true, 'live');
    insert into public.person_sites (person_id, site_id) values ('${TECH}', '${sinai}');
  `);

  async function asUser<T extends Record<string, unknown>>(userId: string | null, sql: string) {
    return db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      if (userId) await tx.exec(`select set_config('request.jwt.claim.sub', '${userId}', true)`);
      return tx.query<T>(sql);
    });
  }

  async function fails(userId: string | null, sql: string) {
    try {
      await asUser(userId, sql);
      return false;
    } catch {
      return true;
    }
  }

  const anonDenied = await fails(null, "select * from public.sites");
  // anon is a different role
  let anonBlocked = false;
  try {
    await db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.query("select * from public.sites");
    });
  } catch {
    anonBlocked = true;
  }
  assert(anonBlocked || anonDenied, "anon can read a table");

  let pinsBlocked = false;
  try {
    await db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.exec(`select set_config('request.jwt.claim.sub', '${TECH}', true)`);
      await tx.query("select * from public.auth_pins");
    });
  } catch {
    pinsBlocked = true;
  }
  assert(pinsBlocked, "auth_pins is readable");

  const techSites = await asUser<{ name: string }>(
    TECH,
    "select name from public.sites order by name",
  );
  assert(techSites.rows.some((row) => row.name === "Mount Sinai Hospital"), "assigned tech cannot see Sinai");
  assert(!techSites.rows.some((row) => row.name.includes("UofT")), "tech can see an unassigned live site");
  assert(!techSites.rows.some((row) => row.name.startsWith("PRACTICE")), "live tech can see practice sites");

  const traineeSites = await asUser<{ name: string; is_sandbox: boolean }>(
    TRAINEE,
    "select name, is_sandbox from public.sites",
  );
  assert(traineeSites.rows.length > 0, "trainee sees no practice sites");
  assert(traineeSites.rows.every((row) => row.is_sandbox), "trainee can read a live site");

  await db.exec(`update public.people set mode = 'practice' where id = '${TECH}'`);
  const practiceView = await asUser<{ is_sandbox: boolean }>(TECH, "select is_sandbox from public.sites");
  assert(practiceView.rows.every((row) => row.is_sandbox), "tech in practice can read live rows");

  const liveWriteBlocked = await fails(
    TECH,
    `insert into public.service_sessions (site_id, person_id, service_date, status, is_sandbox)
     values ('${sinai}', '${TECH}', current_date, 'open', false)`,
  );
  assert(liveWriteBlocked, "tech in practice wrote a live session");

  await db.exec(`update public.people set mode = 'live' where id = '${TECH}'`);
  await db.transaction(async (tx) => {
    await tx.exec(`select set_config('request.jwt.claim.sub', '${TECH}', true)`);
    for (let i = 0; i < 5; i += 1) {
      await tx.query(`select public.start_session($1::uuid, $2::uuid, '2026-11-09T15:00:00Z')`, [
        "66666666-6666-4666-8666-666666666666",
        sinai,
      ]);
    }
  });
  const count = await db.query<{ n: number }>(
    "select count(*)::int as n from public.service_sessions where id = '66666666-6666-4666-8666-666666666666'",
  );
  assert(count.rows[0].n === 1, "start_session was not idempotent");

  const item = await db.query<{ id: string }>(
    `select i.id from public.checklist_items i
     join public.checklist_sections s on s.id = i.section_id
     join public.checklist_templates t on t.id = s.template_id
     join public.models m on m.id = t.model_id
     where m.code = 's35' and i.key = 'gloves' limit 1`,
  );
  const key = "77777777-7777-4777-8777-777777777777";
  await db.transaction(async (tx) => {
    await tx.exec(`select set_config('request.jwt.claim.sub', '${TECH}', true)`);
    for (let rev = 1; rev <= 3; rev += 1) {
      await tx.query(
        `select public.save_completion($1,$2,'done',null,'',null,$3,$4,'gloves')`,
        ["66666666-6666-4666-8666-666666666666", item.rows[0].id, rev, key],
      );
    }
  });
  const completions = await db.query<{ n: number }>(
    "select count(*)::int as n from public.service_item_completions where session_id = '66666666-6666-4666-8666-666666666666'",
  );
  assert(completions.rows[0].n === 1, "completion replay created extra rows");

  const requiredSteps = await db.query<{ id: string; key: string }>(`
    select item->>'id' as id, item->>'key' as key
    from public.service_sessions sess,
      jsonb_array_elements(sess.checklist_snapshot->'sections') sec,
      jsonb_array_elements(sec->'items') item
    where sess.id = '66666666-6666-4666-8666-666666666666'
      and coalesce((item->>'required')::boolean, true)
  `);
  await db.transaction(async (tx) => {
    await tx.exec(`select set_config('request.jwt.claim.sub', '${TECH}', true)`);
    let n = 0;
    for (const row of requiredSteps.rows) {
      if (row.key === "gloves") continue;
      n += 1;
      const idem = `88888888-8888-4888-8888-${n.toString(16).padStart(12, "0")}`;
      await tx.query(
        `select public.save_completion($1,$2,'not_needed',null,'',null,1,$3,$4)`,
        ["66666666-6666-4666-8666-666666666666", row.id, idem, row.key],
      );
    }
  });
  await db.exec(`
    insert into public.photo_audit_shots (session_id, person_id, site_id, shot_key, shot_label, storage_state, is_sandbox)
    select '66666666-6666-4666-8666-666666666666', '${TECH}', '${sinai}', shot, shot, 'local_only', false
    from unnest(array['overall','cleaning','beans','powders','cups','closed','spouts']) as shot
  `);
  await db.transaction(async (tx) => {
    await tx.exec(`select set_config('request.jwt.claim.sub', '${TECH}', true)`);
    await tx.query(`select public.complete_session('66666666-6666-4666-8666-666666666666', null, null)`);
  });
  let locked = false;
  try {
    await db.transaction(async (tx) => {
      await tx.exec(`select set_config('request.jwt.claim.sub', '${TECH}', true)`);
      await tx.exec(
        "update public.service_sessions set start_at = start_at + interval '1 hour' where id = '66666666-6666-4666-8666-666666666666'",
      );
    });
  } catch (err) {
    locked = String(err).includes("locked") || String(err).includes("Submitted");
    if (!locked) throw err;
  }
  assert(locked, "tech changed a submitted time");

  const sensor = await db.query<{ details: string; status: string }>(
    "select details, status from public.checklist_items where key = 'arm_sensor' limit 1",
  );
  assert(sensor.rows[0].status === "pending_validation", "arm sensor is not pending");
  assert(
    sensor.rows[0].details.includes("Albert Kim"),
    "arm sensor placeholder missing",
  );
  const opening = await db.query<{ opening_time: string | null }>(
    "select opening_time from public.sites where short_name = 'UofT' and is_sandbox = false",
  );
  assert(opening.rows[0].opening_time == null, "UofT opening time was set");
  const people = await db.query<{ n: number }>("select count(*)::int as n from public.people");
  assert(people.rows[0].n === 4, "seed created people");

  const helperExposed = await db.query<{ exposed: boolean }>(`
    select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) as exposed
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'current_person_id', 'is_active', 'is_admin', 'in_practice',
        'can_see_site', 'can_write', 'toronto_date'
      )
  `);
  assert(helperExposed.rows[0].exposed !== true, "a public helper is still executable by authenticated");

  const policy = await db.query<{ qual: string }>(
    "select qual from pg_policies where schemaname = 'public' and policyname = 'people_select'",
  );
  assert(policy.rows[0].qual.includes("private.is_admin"), "policies no longer call the private helper");

  const mutable = await db.query<{ n: number }>(`
    select count(*)::int as n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname in ('public', 'private')
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  `);
  assert(mutable.rows[0].n === 0, "a security-definer function has no fixed search_path");

  for (const sql of [
    "select public.reset_sandbox()",
    "select public.decide_correction('00000000-0000-4000-8000-000000000001', true, 'no')",
    "select public.set_training_status('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'solo', 0)",
    "select public.void_session('00000000-0000-4000-8000-000000000001', 'no')",
  ]) {
    let blocked = false;
    try {
      await asUser(TECH, sql);
    } catch (err) {
      blocked = String(err).includes("Not allowed");
      if (!blocked) throw err;
    }
    assert(blocked, `tech was allowed to run ${sql}`);
  }

  const traineeLive = await asUser<{ n: number }>(
    TRAINEE,
    "select count(*)::int as n from public.sites where is_sandbox = false",
  );
  assert(traineeLive.rows[0].n === 0, "trainee can read a live site");
  const traineeWrite = await fails(
    TRAINEE,
    `insert into public.service_sessions (site_id, person_id, service_date, status, is_sandbox)
     values ('${sinai}', '${TRAINEE}', current_date, 'open', false)`,
  );
  assert(traineeWrite, "trainee wrote a live visit");

  const practiceOpen = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const practiceNew = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
  const practiceReplay = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
  const practiceDone = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
  const traineeOpen = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
  const traineeNew = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
  const liveDoneAt = "2026-01-15T12:00:00Z";
  const practiceDoneAt = "2026-02-15T12:00:00Z";

  await db.exec(`update public.people set mode = 'practice' where id = '${TECH}'`);
  await db.transaction(async (tx) => {
    await tx.exec(`select set_config('request.jwt.claim.sub', '${TECH}', true)`);
    await tx.query(`select public.start_session($1::uuid, $2::uuid, '2026-11-10T15:00:00Z')`, [
      practiceOpen,
      practiceSinai,
    ]);
    await tx.query(
      `select public.save_completion($1,$2,'done','','kept',null,1,$3,'gloves')`,
      [practiceOpen, item.rows[0].id, "88888888-8888-4888-8888-888888888888"],
    );
  });
  await db.exec(`
    update public.service_sessions
      set milk_clean_started_at = '2026-11-10T15:05:00Z'
      where id = '${practiceOpen}';
    insert into public.site_item_state (site_id, item_id, last_done_at, is_sandbox)
    values
      ('${sinai}', '${item.rows[0].id}', '${liveDoneAt}', false),
      ('${practiceSinai}', '${item.rows[0].id}', '${practiceDoneAt}', true)
    on conflict (site_id, item_id) do update
      set last_done_at = excluded.last_done_at;
  `);
  const beforeCounts = await db.query<{ sessions: number; completions: number }>(`
    select
      (select count(*)::int from public.service_sessions) as sessions,
      (select count(*)::int from public.service_item_completions where session_id = '${practiceOpen}') as completions
  `);

  await db.exec(`update public.people set mode = 'live' where id = '${TECH}'`);
  let liveModeBlocked = false;
  try {
    await asUser(
      TECH,
      `select public.start_fresh_practice('${practiceOpen}', '${practiceNew}', '2026-11-11T15:00:00Z')`,
    );
  } catch (err) {
    liveModeBlocked = String(err).includes("Practice mode");
    if (!liveModeBlocked) throw err;
  }
  assert(liveModeBlocked, "live mode set aside a practice visit");
  const stillOpen = await db.query<{ status: string }>(
    `select status from public.service_sessions where id = '${practiceOpen}'`,
  );
  assert(stillOpen.rows[0].status === "open", "a refused fresh start changed the practice visit");

  await db.exec(`update public.people set mode = 'practice' where id in ('${TECH}', '${OTHER}')`);
  let otherBlocked = false;
  try {
    await asUser(
      OTHER,
      `select public.start_fresh_practice('${practiceOpen}', '${practiceReplay}', '2026-11-11T15:00:00Z')`,
    );
  } catch (err) {
    otherBlocked = String(err).includes("Not allowed");
    if (!otherBlocked) throw err;
  }
  assert(otherBlocked, "another person set aside a practice visit");

  const started = await asUser<{ id: string; status: string; milk_clean_started_at: string | null }>(
    TECH,
    `select value->>'id' as id, value->>'status' as status, value->>'milk_clean_started_at' as milk_clean_started_at
     from (select public.start_fresh_practice('${practiceOpen}', '${practiceNew}', '2026-11-11T16:00:00Z') as value) s`,
  );
  assert(started.rows[0].id === practiceNew, "fresh start did not return the new visit");
  assert(started.rows[0].status === "open", "fresh visit is not open");
  assert(started.rows[0].milk_clean_started_at == null, "fresh visit kept the old milk timer");

  const afterFresh = await db.query<{
    old_status: string;
    old_completions: number;
    new_completions: number;
    opens: number;
    sessions: number;
    live_done: string;
    practice_done: string;
  }>(`
    select
      (select status from public.service_sessions where id = '${practiceOpen}') as old_status,
      (select count(*)::int from public.service_item_completions where session_id = '${practiceOpen}') as old_completions,
      (select count(*)::int from public.service_item_completions where session_id = '${practiceNew}') as new_completions,
      (select count(*)::int from public.service_sessions where person_id = '${TECH}' and site_id = '${practiceSinai}' and status = 'open') as opens,
      (select count(*)::int from public.service_sessions) as sessions,
      (select last_done_at from public.site_item_state where site_id = '${sinai}' and item_id = '${item.rows[0].id}')::text as live_done,
      (select last_done_at from public.site_item_state where site_id = '${practiceSinai}' and item_id = '${item.rows[0].id}')::text as practice_done
  `);
  assert(afterFresh.rows[0].old_status === "voided", "old practice attempt was not kept");
  assert(afterFresh.rows[0].old_completions === beforeCounts.rows[0].completions, "old taps were deleted");
  assert(afterFresh.rows[0].new_completions === 0, "fresh visit carried taps");
  assert(afterFresh.rows[0].opens === 1, "fresh start left more than one open visit");
  assert(afterFresh.rows[0].sessions === beforeCounts.rows[0].sessions + 1, "fresh start deleted a visit");
  assert(String(afterFresh.rows[0].live_done).startsWith("2026-01-15"), "live last-done changed");
  assert(String(afterFresh.rows[0].practice_done).startsWith("2026-02-15"), "practice last-done changed");

  const replay = await asUser<{ id: string }>(
    TECH,
    `select public.start_fresh_practice('${practiceOpen}', '${practiceReplay}', '2026-11-11T17:00:00Z')->>'id' as id`,
  );
  assert(replay.rows[0].id === practiceNew, "a second tap created another visit");
  const opensAfterReplay = await db.query<{ n: number }>(
    `select count(*)::int as n from public.service_sessions where person_id = '${TECH}' and site_id = '${practiceSinai}' and status = 'open'`,
  );
  assert(opensAfterReplay.rows[0].n === 1, "replaying fresh start opened a second visit");

  await db.exec(
    `update public.service_sessions set status = 'completed', submitted_at = now() where id = '${practiceNew}'`,
  );
  await db.transaction(async (tx) => {
    await tx.exec(`select set_config('request.jwt.claim.sub', '${TECH}', true)`);
    await tx.query(`select public.start_session($1::uuid, $2::uuid, '2026-11-12T15:00:00Z')`, [
      practiceDone,
      practiceSinai,
    ]);
  });
  await db.exec(
    `update public.service_sessions set status = 'completed', submitted_at = now() where id = '${practiceDone}'`,
  );
  let finishedBlocked = false;
  try {
    await asUser(
      TECH,
      `select public.start_fresh_practice('${practiceDone}', '${practiceReplay}', '2026-11-12T18:00:00Z')`,
    );
  } catch (err) {
    finishedBlocked = String(err).includes("already finished");
    if (!finishedBlocked) throw err;
  }
  assert(finishedBlocked, "a finished practice visit was set aside");

  let liveBlocked = false;
  try {
    await asUser(
      TECH,
      `select public.start_fresh_practice('66666666-6666-4666-8666-666666666666', '${practiceReplay}', '2026-11-12T18:00:00Z')`,
    );
  } catch (err) {
    liveBlocked = String(err).includes("Live visits");
    if (!liveBlocked) throw err;
  }
  assert(liveBlocked, "a live visit was set aside");
  const liveStatus = await db.query<{ status: string }>(
    "select status from public.service_sessions where id = '66666666-6666-4666-8666-666666666666'",
  );
  assert(liveStatus.rows[0].status === "completed", "the live visit status changed");

  await db.transaction(async (tx) => {
    await tx.exec(`select set_config('request.jwt.claim.sub', '${TRAINEE}', true)`);
    await tx.query(`select public.start_session($1::uuid, $2::uuid, '2026-11-13T15:00:00Z')`, [
      traineeOpen,
      practiceSinai,
    ]);
  });
  const traineeFresh = await asUser<{ id: string }>(
    TRAINEE,
    `select public.start_fresh_practice('${traineeOpen}', '${traineeNew}', '2026-11-13T16:00:00Z')->>'id' as id`,
  );
  assert(traineeFresh.rows[0].id === traineeNew, "a trainee could not start a fresh practice visit");
  let traineeLiveBlocked = false;
  try {
    await asUser(
      TRAINEE,
      `select public.start_fresh_practice('66666666-6666-4666-8666-666666666666', '${practiceReplay}', '2026-11-13T17:00:00Z')`,
    );
  } catch (err) {
    traineeLiveBlocked = String(err).includes("Not allowed") || String(err).includes("Live visits");
    if (!traineeLiveBlocked) throw err;
  }
  assert(traineeLiveBlocked, "a trainee changed a live visit");

  const freshPriv = await db.query<{ anon_can: boolean; auth_can: boolean }>(`
    select
      has_function_privilege('anon', 'public.start_fresh_practice(uuid, uuid, timestamptz)', 'execute') as anon_can,
      has_function_privilege('authenticated', 'public.start_fresh_practice(uuid, uuid, timestamptz)', 'execute') as auth_can
  `);
  assert(freshPriv.rows[0].anon_can !== true, "anon can call start_fresh_practice");
  assert(freshPriv.rows[0].auth_can === true, "a signed-in person cannot call start_fresh_practice");

  await db.exec(`update public.people set mode = 'live' where id in ('${TECH}', '${OTHER}')`);

  const stillWorks = await asUser<{ name: string }>(TECH, "select name from public.sites");
  assert(
    stillWorks.rows.some((row) => row.name === "Mount Sinai Hospital"),
    "revoking helper RPCs broke row level security",
  );

  const wipe = await db.query<{ id: string }>(
    `select i.id from public.checklist_items i
     join public.checklist_sections s on s.id = i.section_id
     join public.checklist_templates t on t.id = s.template_id
     join public.models m on m.id = t.model_id
     where m.code = 's35' and i.key = 'wipe_cameo' limit 1`,
  );
  const beans = await db.query<{ id: string }>(
    `select i.id from public.checklist_items i
     join public.checklist_sections s on s.id = i.section_id
     join public.checklist_templates t on t.id = s.template_id
     join public.models m on m.id = t.model_id
     where m.code = 's35' and i.key = 'fill_beans' limit 1`,
  );
  const lockVisit = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
  await db.transaction(async (tx) => {
    await tx.exec(`select set_config('request.jwt.claim.sub', '${TECH}', true)`);
    await tx.query(`select public.start_session($1::uuid, $2::uuid, '2026-11-14T15:00:00Z')`, [lockVisit, sinai]);
  });
  await db.exec(`update public.service_sessions set milk_clean_started_at = now() where id = '${lockVisit}'`);

  async function saveStep(itemId: string, state: string, rev: number, key: string) {
    return asUser(
      TECH,
      `select public.save_completion('${lockVisit}', '${itemId}', '${state}', null, '', null, ${rev}, '${key}', 'step')`,
    );
  }
  async function saveFails(itemId: string, state: string, rev: number, key: string, text: string) {
    try {
      await saveStep(itemId, state, rev, key);
      return false;
    } catch (err) {
      const message = String(err);
      if (!message.includes(text)) throw err;
      return true;
    }
  }

  assert(
    await saveFails(wipe.rows[0].id, "done", 1, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", "Done unlocks"),
    "Wipe the Cameo accepted Done while cleaning was running",
  );
  await saveStep(wipe.rows[0].id, "not_needed", 2, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3");
  const skipped = await db.query<{ state: string }>(
    `select state from public.service_item_completions where session_id = '${lockVisit}' and item_id = '${wipe.rows[0].id}'`,
  );
  assert(skipped.rows[0].state === "not_needed", "Not needed was not saved on Wipe the Cameo");
  assert(
    await saveFails(wipe.rows[0].id, "done", 3, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", "Done unlocks"),
    "Wipe the Cameo could switch to Done while cleaning was running",
  );
  assert(
    await saveFails(beans.rows[0].id, "not_needed", 1, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4", "stays locked"),
    "Fill beans accepted Not needed while cleaning was running",
  );
  assert(
    await saveFails(beans.rows[0].id, "done", 1, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5", "stays locked"),
    "Fill beans accepted Done while cleaning was running",
  );

  await db.exec(`update public.service_sessions set milk_clean_done_at = now() where id = '${lockVisit}'`);
  await saveStep(wipe.rows[0].id, "done", 4, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3");
  await saveStep(beans.rows[0].id, "done", 2, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5");
  const after = await db.query<{ key: string; state: string }>(
    `select i.key, c.state
     from public.service_item_completions c
     join public.checklist_items i on i.id = c.item_id
     where c.session_id = '${lockVisit}'
     order by i.key`,
  );
  assert(after.rows.find((row) => row.key === "wipe_cameo")?.state === "done", "Done stayed locked after cleaning finished");
  assert(after.rows.find((row) => row.key === "fill_beans")?.state === "done", "Fill beans stayed locked after cleaning finished");

  const openSinai = await db.query<{ id: string }>(
    `select id from public.service_sessions where person_id = '${TECH}' and site_id = '${sinai}' and status = 'open' limit 1`,
  );
  const abandonVisit = openSinai.rows[0].id;
  let abandonOther = false;
  try {
    await asUser(OTHER, `select public.abandon_visit('${abandonVisit}', 'I cannot finish')`);
  } catch (err) {
    abandonOther = String(err).includes("Not allowed");
    if (!abandonOther) throw err;
  }
  assert(abandonOther, "another person closed a live visit");
  let shortReason = false;
  try {
    await asUser(TECH, `select public.abandon_visit('${abandonVisit}', 'no')`);
  } catch (err) {
    shortReason = String(err).includes("why");
    if (!shortReason) throw err;
  }
  assert(shortReason, "a short reason closed a visit");
  await asUser(TECH, `select public.abandon_visit('${abandonVisit}', 'Machine is down')`);
  const abandoned = await db.query<{ status: string }>(
    `select status from public.service_sessions where id = '${abandonVisit}'`,
  );
  assert(abandoned.rows[0].status === "voided", "can't-finish did not close the visit");
  const replacement = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
  await db.transaction(async (tx) => {
    await tx.exec(`select set_config('request.jwt.claim.sub', '${TECH}', true)`);
    await tx.query(`select public.start_session($1::uuid, $2::uuid, '2026-11-15T18:00:00Z')`, [replacement, sinai]);
  });
  const reopened = await db.query<{ n: number }>(
    `select count(*)::int as n from public.service_sessions where id = '${replacement}' and status = 'open'`,
  );
  assert(reopened.rows[0].n === 1, "a new visit could not start after can't-finish");

  let techReset = false;
  try {
    await asUser(TECH, `select public.reset_person_sandbox('${TECH}')`);
  } catch (err) {
    techReset = String(err).includes("Not allowed");
    if (!techReset) throw err;
  }
  assert(techReset, "a tech reset practice data");

  await db.exec(`update public.people set mode = 'practice' where id = '${TECH}'`);
  const practiceOnly = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
  await db.transaction(async (tx) => {
    await tx.exec(`select set_config('request.jwt.claim.sub', '${TECH}', true)`);
    await tx.query(`select public.start_session($1::uuid, $2::uuid, '2026-11-16T15:00:00Z')`, [practiceOnly, practiceSinai]);
  });
  await db.exec(`update public.people set mode = 'live' where id = '${ADMIN}'`);
  await asUser(ADMIN, `select public.reset_person_sandbox('${TECH}')`);
  const practiceLeft = await db.query<{ n: number }>(
    `select count(*)::int as n from public.service_sessions where id = '${practiceOnly}'`,
  );
  const liveLeft = await db.query<{ n: number }>(
    `select count(*)::int as n from public.service_sessions where id = '${replacement}'`,
  );
  assert(practiceLeft.rows[0].n === 0, "per-person reset left the practice visit");
  assert(liveLeft.rows[0].n === 1, "per-person reset removed a live visit");

  let techAsset = false;
  try {
    await asUser(
      TECH,
      `insert into public.person_access_items (person_id, site_id, kind) values ('${TECH}', '${sinai}', 'key_card')`,
    );
  } catch {
    techAsset = true;
  }
  assert(techAsset, "a tech inserted a held key");

  await db.exec(`update public.people set mode = 'live' where id = '${TECH}'`);
  let missingSteps = false;
  try {
    await asUser(TECH, `select public.complete_session('${replacement}', null, null)`);
  } catch (err) {
    missingSteps = String(err).includes("Required steps");
    if (!missingSteps) throw err;
  }
  assert(missingSteps, "complete accepted a visit with required steps open");
  let doneTooSoon = false;
  try {
    await asUser(TECH, `select public.set_milk_clean('${replacement}', 'done', null)`);
  } catch (err) {
    doneTooSoon = String(err).includes("Start milk cleaning");
    if (!doneTooSoon) throw err;
  }
  assert(doneTooSoon, "milk cleaning was marked done before it started");
  await db.transaction(async (tx) => {
    await tx.exec(`select set_config('request.jwt.claim.sub', '${TECH}', true)`);
    await tx.query(`select public.set_milk_clean($1, 'start', null)`, [replacement]);
  });
  const milkStarted = await db.query<{ started: string | null }>(
    `select milk_clean_started_at::text as started from public.service_sessions where id = '${replacement}'`,
  );
  assert(Boolean(milkStarted.rows[0].started), "milk cleaning stayed blocked by prep order");

  const cups = crypto.randomUUID();
  await db.exec(`
    insert into public.skus (id, name, base_unit, source, is_sandbox) values ('${cups}', 'Test cups', 'cups', 'dupont', false);
    insert into public.inventory_tx (sku_id, type, delta_base, location, is_sandbox, idempotency_key)
    values ('${cups}', 'receipt', 5, 'dupont', false, '${crypto.randomUUID()}');
  `);
  const pickupKey = crypto.randomUUID();
  await asUser(TECH, `select public.record_dupont_pickup('${cups}', '${sinai}', 1, 'test', '${pickupKey}')`);
  await asUser(TECH, `select public.record_dupont_pickup('${cups}', '${sinai}', 1, 'test', '${pickupKey}')`);
  const taken = await db.query<{ n: number; qty: number }>(
    `select count(*)::int as n, coalesce(sum(-delta_base), 0)::float as qty
     from public.inventory_tx where idempotency_key = '${pickupKey}'`,
  );
  assert(taken.rows[0].n === 1 && taken.rows[0].qty === 1, "pickup was not idempotent");
  await db.exec(`update public.people set mode = 'practice' where id = '${TECH}'`);
  let practiceLive = false;
  try {
    await asUser(TECH, `select public.record_dupont_pickup('${cups}', '${sinai}', 1, 'no', '${crypto.randomUUID()}')`);
  } catch (err) {
    practiceLive = String(err).includes("Practice cannot");
    if (!practiceLive) throw err;
  }
  assert(practiceLive, "practice pickup changed live Dupont stock");
  await db.exec(`update public.people set mode = 'live' where id = '${TECH}'`);

  console.log("RLS checks passed");
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
