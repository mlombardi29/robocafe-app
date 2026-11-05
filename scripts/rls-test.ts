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

  const stillWorks = await asUser<{ name: string }>(TECH, "select name from public.sites");
  assert(
    stillWorks.rows.some((row) => row.name === "Mount Sinai Hospital"),
    "revoking helper RPCs broke row level security",
  );

  console.log("RLS checks passed");
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
