/**
 * Local PostgreSQL gate for trip pay.
 * Applies the live set 0001–0010, 0016–0019, then 0020.
 * Does not apply 0011–0015. Does not touch the hosted project.
 *
 * Run: npx tsx scripts/verify-0020-trip-pay.ts
 */
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("/tmp/node_modules/pg/package.json");
const { Client } = require("pg") as typeof import("pg");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbName = "kioskops_0020_gate";
const databaseUrl = process.env.DATABASE_URL ?? `postgresql:///${dbName}?host=/var/run/postgresql`;
const outDir = resolve("/opt/cursor/artifacts/trip-pay-0020");

const live = [
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
  "0016_servicing_ops_facts.sql",
  "0017_coverage_charges.sql",
  "0018_edit_charges.sql",
  "0019_tech_warehouse_recount.sql",
  "0020_trip_pay.sql",
];

const ADMIN = "11111111-1111-4111-8111-111111111111";
const TECH = "22222222-2222-4222-8222-222222222222";
const OTHER = "44444444-4444-4444-8444-444444444444";

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
function num(value: unknown): number {
  return Number(value);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const sql0020 = fileSql("0020_trip_pay.sql");
  const hash0020 = sha256(sql0020);

  spawnSync("psql", ["postgresql:///postgres?host=/var/run/postgresql", "-c", `drop database if exists ${dbName};`], {
    encoding: "utf8",
  });
  const created = spawnSync(
    "psql",
    ["postgresql:///postgres?host=/var/run/postgresql", "-v", "ON_ERROR_STOP=1", "-c", `create database ${dbName} owner ubuntu;`],
    { encoding: "utf8" },
  );
  if (created.status !== 0) throw new Error(created.stderr || created.stdout || "create database failed");

  psql(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  for (const name of live) psql(fileSql(name));

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  async function asUser<T extends Record<string, unknown>>(userId: string, sql: string, params: unknown[] = []) {
    await client.query("begin");
    try {
      await client.query("set local role authenticated");
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      const result = await client.query<T>(sql, params);
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }
  async function errorIncludes(userId: string, sql: string, text: string, params: unknown[] = []) {
    try {
      await asUser(userId, sql, params);
      return false;
    } catch (err) {
      return String(err).toLowerCase().includes(text.toLowerCase());
    }
  }

  const clock = await client.query<{ today: string; effective: string }>(`
    select (now() at time zone 'America/Toronto')::date::text as today,
           (select value from public.config where key = 'trip_pay_effective_on') as effective
  `);
  const today = clock.rows[0].today;
  const effective = clock.rows[0].effective;
  const bounds = await client.query<{ monday: string; sunday: string }>(
    `select ($1::date - (extract(isodow from $1::date)::int - 1))::text as monday,
            ($1::date - (extract(isodow from $1::date)::int - 1) + 6)::text as sunday`,
    [today],
  );
  const monday = bounds.rows[0].monday;
  const sunday = bounds.rows[0].sunday;
  const eligible: string[] = [];
  for (let cursor = monday < effective ? effective : monday; cursor <= today && cursor <= sunday; ) {
    eligible.push(cursor);
    const next = await client.query<{ d: string }>(`select ($1::date + 1)::text as d`, [cursor]);
    cursor = next.rows[0].d;
  }
  assert(eligible.length >= 2, `need two trip days in this week on or after ${effective}; clock is ${today}`);
  const milkDay = eligible[0];
  const pickupDay = eligible[eligible.length - 1];
  assert(milkDay !== pickupDay, "milk run and pickup need different days");

  const sites = await client.query<{ id: string; short_name: string; is_sandbox: boolean }>(
    `select id, short_name, is_sandbox from public.sites where short_name in ('Sinai', 'UofT', 'PRACTICE Sinai', 'PRACTICE UofT')`,
  );
  const site = (name: string, sandbox: boolean) => {
    const row = sites.rows.find((item) => item.short_name === name && item.is_sandbox === sandbox);
    if (!row) throw new Error(`missing site ${name}`);
    return row.id;
  };
  const sinai = site("Sinai", false);
  const uoft = site("UofT", false);
  const practiceSinai = site("PRACTICE Sinai", true);
  const practiceUoft = site("PRACTICE UofT", true);

  await client.query(
    `insert into public.people (id, auth_user_id, full_name, goes_by, role, active, mode) values
      ($1, $1, 'Admin Example', 'Admin', 'admin', true, 'live'),
      ($2, $2, 'Tech Example', 'Tech', 'tech', true, 'live'),
      ($3, $3, 'Other Example', 'Other', 'tech', true, 'live')`,
    [ADMIN, TECH, OTHER],
  );
  await client.query(
    `insert into public.person_sites (person_id, site_id) values ($1, $2), ($1, $3)`,
    [TECH, sinai, uoft],
  );
  await client.query(
    `insert into public.pay_rates (person_id, hourly_rate, effective_on, is_sandbox) values ($1, 22, '2026-01-01', false)`,
    [TECH],
  );

  const shiftId = randomUUID();
  await client.query(
    `insert into public.service_sessions (id, site_id, person_id, service_date, status, start_at, end_at, is_sandbox)
     values ($1, $2, $3, $4::date, 'completed', timestamptz '2026-06-01 15:00+00', timestamptz '2026-06-01 16:30+00', false)`,
    [shiftId, sinai, TECH, pickupDay],
  );
  const formula = await client.query<{ amount: string; hours: string }>(
    `select round((90 / 60.0) * 22, 2)::text as amount, round(90 / 60.0, 2)::text as hours`,
  );

  const firstPay = await asUser<{ amount: string; hours: string; trips: string; reimb: string }>(
    ADMIN,
    `select payload->>'amount' as amount, payload->>'hours' as hours,
            payload->>'trips_amount' as trips, payload->>'reimbursements_amount' as reimb
     from (select public.save_pay_run($1::uuid, $2::date, $3::date, array[$4::uuid], $5::uuid) as payload) s`,
    [TECH, monday, sunday, shiftId, randomUUID()],
  );
  assert(firstPay.rows[0].amount === formula.rows[0].amount, `shift amount ${firstPay.rows[0].amount} != ${formula.rows[0].amount}`);
  assert(firstPay.rows[0].hours === formula.rows[0].hours, `shift hours changed`);
  assert(num(firstPay.rows[0].trips) === 0 && num(firstPay.rows[0].reimb) === 0, "a shift-only run picked up trip pay");
  const line = await client.query<{ minutes: number; amount: string }>(
    `select minutes, amount::text as amount from public.payment_lines where session_id = $1`,
    [shiftId],
  );
  assert(line.rows[0].minutes === 90 && line.rows[0].amount === formula.rows[0].amount, "payment line is not the shift math");

  const noSite = await errorIncludes(
    TECH,
    `select public.log_trip('milk_run', $1::date, '{}'::uuid[], null, 4, true, $2::uuid)`,
    "at least one site",
    [milkDay, randomUUID()],
  );
  assert(noSite, "a milk run with no site was saved");

  const milkKey = randomUUID();
  const milk = await asUser<{ id: string; rate: string; sites: number; charge: string; url: string | null }>(
    TECH,
    `select payload->>'id' as id, payload->>'rate_amount' as rate,
            jsonb_array_length(payload->'site_ids') as sites,
            payload->>'charge_id' as charge, payload->>'receipt_url' as url
     from (
       select public.log_trip('milk_run', $1::date, array[$2::uuid, $3::uuid], null, 8.75, true, $4::uuid) as payload
     ) s`,
    [milkDay, sinai, uoft, milkKey],
  );
  assert(num(milk.rows[0].rate) === 10, "multi-site milk run did not pay $10 once");
  assert(Number(milk.rows[0].sites) === 2, "milk run did not store both sites");
  assert(milk.rows[0].url == null, "receipt_url was written");
  const milkCharge = await client.query<{ n: number; amount: string; paid: boolean }>(
    `select count(*)::int as n, max(amount)::text as amount, bool_or(paid) as paid
     from public.charges where trip_log_id = $1`,
    [milk.rows[0].id],
  );
  assert(milkCharge.rows[0].n === 1 && num(milkCharge.rows[0].amount) === 8.75 && milkCharge.rows[0].paid === false, "milk reimbursement was not one unpaid charge");
  const replay = await asUser<{ id: string }>(
    TECH,
    `select public.log_trip('milk_run', $1::date, array[$2::uuid], null, 99, true, $3::uuid)->>'id' as id`,
    [milkDay, sinai, milkKey],
  );
  assert(replay.rows[0].id === milk.rows[0].id, "idempotency key created a second trip");

  const pickup = await asUser<{ id: string; rate: string }>(
    TECH,
    `select payload->>'id' as id, payload->>'rate_amount' as rate
     from (select public.log_trip('warehouse_pickup', $1::date, '{}'::uuid[], 'bags', null, false, $2::uuid) as payload) s`,
    [pickupDay, randomUUID()],
  );
  assert(num(pickup.rows[0].rate) === 12, "warehouse pickup did not copy $12");
  const secondPickup = await errorIncludes(
    TECH,
    `select public.log_trip('warehouse_pickup', $1::date, '{}'::uuid[], null, null, false, $2::uuid)`,
    "warehouse pickup",
    [pickupDay, randomUUID()],
  );
  assert(secondPickup, "a second warehouse pickup on the same day was saved");
  const secondMilk = await errorIncludes(
    TECH,
    `select public.log_trip('milk_run', $1::date, array[$2::uuid], null, 3, true, $3::uuid)`,
    "milk run",
    [milkDay, sinai, randomUUID()],
  );
  assert(secondMilk, "a second milk run on the same day was saved");

  await client.query(`update public.config set value = '18' where key = 'trip_rate_milk_run'`);
  const edited = await asUser<{ rate: string; sites: number }>(
    TECH,
    `select payload->>'rate_amount' as rate, jsonb_array_length(payload->'site_ids') as sites
     from (select public.edit_trip($1::uuid, array[$2::uuid, $3::uuid], 'oat', 8.75, true, $4::uuid) as payload) s`,
    [milk.rows[0].id, uoft, sinai, randomUUID()],
  );
  assert(num(edited.rows[0].rate) === 10 && Number(edited.rows[0].sites) === 2, "edit rewrote the copied rate or dropped a site");
  await client.query(`update public.config set value = '10' where key = 'trip_rate_milk_run'`);

  await client.query(`select set_config('request.jwt.claim.sub', '', false)`);
  await client.query(
    `insert into public.trip_logs (person_id, trip_on, kind, rate_amount, receipt_attested, is_sandbox, voided)
     values ($1, $2::date, 'warehouse_pickup', 99, false, false, true)`,
    [TECH, pickupDay],
  );
  let expectedTrips = 22;
  if (monday !== milkDay && monday !== pickupDay) {
    await client.query(
      `insert into public.trip_logs (person_id, trip_on, kind, rate_amount, receipt_attested, is_sandbox)
       values ($1, $2::date, 'warehouse_pickup', 12, false, false)`,
      [TECH, monday],
    );
    if (monday >= effective) expectedTrips += 12;
  }
  if (sunday !== milkDay && sunday !== pickupDay) {
    await client.query(
      `insert into public.trip_logs (person_id, trip_on, kind, rate_amount, receipt_attested, is_sandbox)
       values ($1, $2::date, 'warehouse_pickup', 12, false, false)`,
      [TECH, sunday],
    );
    expectedTrips += 12;
  }
  const before = await client.query<{ d: string }>(`select ($1::date - 1)::text as d`, [monday]);
  const after = await client.query<{ d: string }>(`select ($1::date + 1)::text as d`, [sunday]);
  await client.query(
    `insert into public.trip_logs (person_id, trip_on, kind, rate_amount, receipt_attested, is_sandbox)
     values ($1, $2::date, 'warehouse_pickup', 50, false, false),
            ($1, $3::date, 'warehouse_pickup', 50, false, false)`,
    [TECH, before.rows[0].d, after.rows[0].d],
  );

  const early = await errorIncludes(
    TECH,
    `select public.log_trip('warehouse_pickup', '2026-11-24'::date, '{}'::uuid[], null, null, false, $1::uuid)`,
    "2026-11-25",
    [randomUUID()],
  );
  assert(early, "a trip before 25 Nov 2026 was accepted");

  const withTrips = await asUser<{ amount: string; hours: string; trips: string; reimb: string }>(
    ADMIN,
    `select payload->>'amount' as amount, payload->>'hours' as hours,
            payload->>'trips_amount' as trips, payload->>'reimbursements_amount' as reimb
     from (select public.save_pay_run($1::uuid, $2::date, $3::date, array[$4::uuid], $5::uuid) as payload) s`,
    [TECH, monday, sunday, shiftId, randomUUID()],
  );
  assert(withTrips.rows[0].amount === formula.rows[0].amount, "save_pay_run shift total changed after trips");
  assert(withTrips.rows[0].hours === formula.rows[0].hours, "save_pay_run hours changed after trips");
  assert(num(withTrips.rows[0].trips) === expectedTrips, `trips_amount ${withTrips.rows[0].trips} != ${expectedTrips}`);
  assert(num(withTrips.rows[0].reimb) === 0, "milk reimbursement was paid before the receipt was received");

  const payHeld = await errorIncludes(
    ADMIN,
    `select public.set_charge_paid($1::uuid, true, $2::uuid)`,
    "receipt",
    [milk.rows[0].charge, randomUUID()],
  );
  assert(payHeld, "a milk reimbursement was marked paid before the receipt was received");

  await asUser(
    ADMIN,
    `select public.set_trip_receipt($1::uuid, true, $2::uuid)`,
    [milk.rows[0].id, randomUUID()],
  );
  const stillUnpaid = await client.query<{ paid: boolean }>(
    `select paid from public.charges where id = $1`,
    [milk.rows[0].charge],
  );
  assert(stillUnpaid.rows[0].paid === false, "marking the receipt received also marked the reimbursement paid");

  await asUser(
    TECH,
    `select public.add_charge(4.00, null, 'Lids', null, $1::uuid)`,
    [randomUUID()],
  );
  const paidCharge = await asUser<{ id: string }>(
    TECH,
    `select public.add_charge(3.00, null, 'Already', null, $1::uuid)->>'id' as id`,
    [randomUUID()],
  );
  await asUser(
    ADMIN,
    `select public.set_charge_paid($1::uuid, true, $2::uuid)`,
    [paidCharge.rows[0].id, randomUUID()],
  );

  const withReimb = await asUser<{ amount: string; trips: string; reimb: string }>(
    ADMIN,
    `select payload->>'amount' as amount, payload->>'trips_amount' as trips, payload->>'reimbursements_amount' as reimb
     from (select public.save_pay_run($1::uuid, $2::date, $3::date, array[$4::uuid], $5::uuid) as payload) s`,
    [TECH, monday, sunday, shiftId, randomUUID()],
  );
  assert(withReimb.rows[0].amount === formula.rows[0].amount, "shift total changed when reimbursements were added");
  assert(num(withReimb.rows[0].trips) === expectedTrips, "trip total changed when reimbursements were added");
  assert(num(withReimb.rows[0].reimb) === 12.75, `reimbursements_amount ${withReimb.rows[0].reimb} != 12.75`);

  await client.query(`update public.people set mode = 'practice' where id = $1`, [TECH]);
  const practiceTrip = await asUser<{ id: string; sandbox: boolean }>(
    TECH,
    `select (payload->>'is_sandbox')::boolean as sandbox, payload->>'id' as id
     from (select public.log_trip('milk_run', $1::date, array[$2::uuid, $3::uuid], null, 2.50, true, $4::uuid) as payload) s`,
    [pickupDay, practiceSinai, practiceUoft, randomUUID()],
  );
  assert(practiceTrip.rows[0].sandbox === true, "practice trip stored as live");
  await client.query(`update public.people set mode = 'live' where id = $1`, [TECH]);
  const liveAgain = await asUser<{ amount: string; trips: string }>(
    ADMIN,
    `select payload->>'amount' as amount, payload->>'trips_amount' as trips
     from (select public.save_pay_run($1::uuid, $2::date, $3::date, array[$4::uuid], $5::uuid) as payload) s`,
    [TECH, monday, sunday, shiftId, randomUUID()],
  );
  assert(liveAgain.rows[0].amount === formula.rows[0].amount, "practice trip changed live shift pay");
  assert(num(liveAgain.rows[0].trips) === expectedTrips, "practice trip was included in the live pay run");

  const payId = await client.query<{ id: string }>(
    `select id from public.payments where person_id = $1 and is_sandbox = false and voided = false order by created_at desc limit 1`,
    [TECH],
  );
  const marked = await asUser<{ amount: string; trips: string; reimb: string; status: string }>(
    ADMIN,
    `select payload->>'amount' as amount, payload->>'trips_amount' as trips,
            payload->>'reimbursements_amount' as reimb, payload->>'status' as status
     from (select public.mark_pay_run($1::uuid, 'paid', $2::date) as payload) s`,
    [payId.rows[0].id, today],
  );
  assert(marked.rows[0].status === "paid", "pay run was not marked paid");
  assert(marked.rows[0].amount === formula.rows[0].amount, "marking paid changed the shift total");
  assert(num(marked.rows[0].trips) === expectedTrips, "marking paid changed the trip total");
  assert(num(marked.rows[0].reimb) === 12.75, "marking paid changed the reimbursement total");

  const paidCharges = await client.query<{ note: string; paid: boolean; payment_id: string | null }>(
    `select note, paid, payment_id::text from public.charges where person_id = $1 and is_sandbox = false and not voided order by note`,
    [TECH],
  );
  const byNote = new Map(paidCharges.rows.map((row) => [row.note, row]));
  assert(byNote.get("Milk run")?.paid === true && byNote.get("Milk run")?.payment_id === payId.rows[0].id, "milk reimbursement was not paid by the pay run");
  assert(byNote.get("Lids")?.paid === true && byNote.get("Lids")?.payment_id === payId.rows[0].id, "unpaid reimbursement was not paid by the pay run");
  assert(byNote.get("Already")?.paid === true && byNote.get("Already")?.payment_id == null, "a Charges-page payment was linked to the pay run");

  const again = await asUser<{ trips: string; reimb: string }>(
    ADMIN,
    `select payload->>'trips_amount' as trips, payload->>'reimbursements_amount' as reimb
     from (select public.mark_pay_run($1::uuid, 'paid', $2::date) as payload) s`,
    [payId.rows[0].id, today],
  );
  assert(num(again.rows[0].trips) === expectedTrips && num(again.rows[0].reimb) === 12.75, "marking paid twice changed the recorded totals");
  const stillOne = await client.query<{ n: number }>(
    `select count(*)::int as n from public.charges where person_id = $1 and payment_id = $2`,
    [TECH, payId.rows[0].id],
  );
  assert(stillOne.rows[0].n === 2, "marking paid twice attached extra reimbursements");

  const editPaid = await errorIncludes(
    TECH,
    `select public.edit_trip($1::uuid, '{}'::uuid[], 'late', null, false, $2::uuid)`,
    "paid week",
    [pickup.rows[0].id, randomUUID()],
  );
  assert(editPaid, "a paid trip was edited");
  const voidPaid = await errorIncludes(
    ADMIN,
    `select public.void_trip($1::uuid, $2::uuid)`,
    "paid week",
    [pickup.rows[0].id, randomUUID()],
  );
  assert(voidPaid, "a paid trip was voided");

  const otherTrip = await asUser<{ id: string; person: string }>(
    OTHER,
    `select payload->>'id' as id, payload->>'person_id' as person
     from (select public.log_trip('warehouse_pickup', $1::date, '{}'::uuid[], null, null, false, $2::uuid) as payload) s`,
    [pickupDay, randomUUID()],
  );
  assert(otherTrip.rows[0].person === OTHER, "a tech logged a trip for someone else");
  await client.query(
    `insert into public.person_sites (person_id, site_id) values ($1, $2) on conflict (person_id, site_id) do nothing`,
    [OTHER, sinai],
  );
  const otherMilk = await asUser<{ rate: string }>(
    OTHER,
    `select public.log_trip('milk_run', $1::date, array[$2::uuid], null, 5, true, $3::uuid)->>'rate_amount' as rate`,
    [pickupDay, sinai, randomUUID()],
  );
  assert(num(otherMilk.rows[0].rate) === 10, "a pickup and a milk run on the same day were not both allowed");
  const otherSecondMilk = await errorIncludes(
    OTHER,
    `select public.log_trip('milk_run', $1::date, array[$2::uuid], null, 1, true, $3::uuid)`,
    "milk run",
    [pickupDay, sinai, randomUUID()],
  );
  assert(otherSecondMilk, "a second milk run on the same day was saved");
  const otherSecondPickup = await errorIncludes(
    OTHER,
    `select public.log_trip('warehouse_pickup', $1::date, '{}'::uuid[], null, null, false, $2::uuid)`,
    "warehouse pickup",
    [pickupDay, randomUUID()],
  );
  assert(otherSecondPickup, "a second warehouse pickup on the same day was saved");
  const editOther = await errorIncludes(
    TECH,
    `select public.edit_trip($1::uuid, '{}'::uuid[], 'no', null, false, $2::uuid)`,
    "Not allowed",
    [otherTrip.rows[0].id, randomUUID()],
  );
  assert(editOther, "a tech edited another person's trip");
  await asUser(ADMIN, `select public.void_trip($1::uuid, $2::uuid)`, [otherTrip.rows[0].id, randomUUID()]);
  const editVoided = await errorIncludes(
    OTHER,
    `select public.edit_trip($1::uuid, '{}'::uuid[], 'back', null, false, $2::uuid)`,
    "voided",
    [otherTrip.rows[0].id, randomUUID()],
  );
  assert(editVoided, "a voided trip was edited");
  const againAfterVoid = await asUser<{ id: string }>(
    OTHER,
    `select public.log_trip('warehouse_pickup', $1::date, '{}'::uuid[], 'replacement', null, false, $2::uuid)->>'id' as id`,
    [pickupDay, randomUUID()],
  );
  assert(againAfterVoid.rows[0].id !== otherTrip.rows[0].id, "a voided day could not be logged again");

  const inserted = await errorIncludes(
    OTHER,
    `insert into public.trip_logs (person_id, trip_on, kind, rate_amount, receipt_attested, is_sandbox)
     values ($1, '2030-01-02'::date, 'warehouse_pickup', 12, false, false)`,
    "row-level security",
    [TECH],
  );
  assert(inserted, "a tech inserted a trip for someone else");

  const hidden = await asUser<{ n: number }>(
    TECH,
    `select count(*)::int as n from public.trip_logs where id = $1`,
    [practiceTrip.rows[0].id],
  );
  assert(hidden.rows[0].n === 0, "live mode can see a practice trip");
  await client.query(`update public.people set mode = 'practice' where id = $1`, [TECH]);
  const practiceHidden = await asUser<{ n: number }>(
    TECH,
    `select count(*)::int as n from public.trip_logs where id = $1`,
    [pickup.rows[0].id],
  );
  assert(practiceHidden.rows[0].n === 0, "practice mode can see a live trip");
  await client.query(`update public.people set mode = 'live' where id = $1`, [TECH]);

  const finalShift = await client.query<{ amount: string; hours: string }>(
    `select amount::text as amount, hours::text as hours from public.payments where id = $1`,
    [payId.rows[0].id],
  );
  assert(finalShift.rows[0].amount === formula.rows[0].amount && finalShift.rows[0].hours === formula.rows[0].hours, "stored shift pay drifted");

  const report = {
    result: "PASS",
    migration0020Sha256: hash0020,
    loaded: live,
    notLoaded: ["0011", "0012", "0013", "0014", "0015"],
    hostedWrites: 0,
    shiftAmount: formula.rows[0].amount,
    shiftHours: formula.rows[0].hours,
    tripsAmount: expectedTrips,
    reimbursementsAmount: 12.75,
    week: { monday, sunday },
    milkDay,
    pickupDay,
    oneOfEachKindPerDay: "one non-voided warehouse pickup and one non-voided milk run per technician per trip_on date; live and practice are separate slots; voiding frees that kind; unique index trip_logs_one_kind_per_day",
  };
  writeFileSync(resolve(outDir, "0020-local-pg-gate.json"), JSON.stringify(report, null, 2));
  writeFileSync(resolve(outDir, "0020_trip_pay.sha256"), `${hash0020}  0020_trip_pay.sql\n`);
  console.log(JSON.stringify(report, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
