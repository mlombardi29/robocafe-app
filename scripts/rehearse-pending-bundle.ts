/**
 * Isolated rehearsal of pending migrations 0011–0014.
 * Uses a local Postgres named on DATABASE_URL. Does not connect to the hosted project.
 *
 * Proves:
 * - one transaction rolls back after an intentional failure, leaving 0010's functions in place
 * - the bundled file then commits as one transaction
 * - two connections racing the same new visit id do not return the other person's row
 *
 * Run: DATABASE_URL=postgresql:///kioskops_rehearse npx tsx scripts/rehearse-pending-bundle.ts
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
const databaseUrl = process.env.DATABASE_URL ?? "postgresql:///kioskops_rehearse?host=/var/run/postgresql";
const parts = [
  "0011_ops_batch.sql",
  "0012_photo_audit_grandfather.sql",
  "0013_preview_relay_guards.sql",
  "0014_atomic_photo_relay.sql",
];
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

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function psql(sql: string, ok = true, tuples = false) {
  const args = [databaseUrl, "-v", "ON_ERROR_STOP=1"];
  if (tuples) args.push("-t", "-A");
  args.push("-f", "-");
  const result = spawnSync("psql", args, {
    input: sql,
    encoding: "utf8",
  });
  if (ok && result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "psql failed");
  }
  return result;
}

function fileSql(name: string) {
  return readFileSync(resolve(root, "supabase/migrations", name), "utf8");
}

async function main() {
  const bodies = parts.map((name) => ({ name, sql: fileSql(name), sha256: sha256(fileSql(name)) }));
  const bundleDir = resolve(root, "supabase/pending");
  mkdirSync(bundleDir, { recursive: true });
  const bundleName = "0011_0014_kioskops_ops.sql";
  const header = [
    "-- Pending bundle for one hosted migration entry. Not applied by this repository.",
    "-- Constituent files, in order, with SHA-256 of each file's exact bytes:",
    ...bodies.map((part) => `-- ${part.name} ${part.sha256}`),
    "-- Do not add BEGIN/COMMIT here. The SQL editor or a proven single-query transaction supplies that.",
    "-- Applying 0011, 0012, or 0013 and stopping leaves that file's functions callable.",
    "",
  ].join("\n");
  const bundlePath = resolve(bundleDir, bundleName);
  writeFileSync(bundlePath, `${header}${bodies.map((part) => part.sql.trim()).join("\n\n")}\n`);
  const bundleSha = sha256(readFileSync(bundlePath));
  writeFileSync(
    resolve(bundleDir, "0011_0014_kioskops_ops.sha256"),
    `${bundleSha}  ${bundleName}\n${bodies.map((part) => `${part.sha256}  ${part.name}`).join("\n")}\n`,
  );

  const preamble = `
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `;
  psql(preamble);
  for (const name of base) psql(fileSql(name));

  const rolled = psql(`BEGIN;\n${fileSql("0011_ops_batch.sql")}\n${fileSql("0012_photo_audit_grandfather.sql")}\nDO $$ BEGIN RAISE EXCEPTION 'intentional rollback'; END $$;\n`, false);
  assert(rolled.status !== 0 && (rolled.stderr + rolled.stdout).includes("intentional rollback"), "the intentional failure did not abort");
  const afterRollback = psql(`
    select to_regclass('public.photo_audit_shots') is null as absent;
    select pronargs from pg_proc where proname = 'start_session' and pronamespace = 'public'::regnamespace;
  `, true, true);
  const rollbackLines = afterRollback.stdout.trim().split("\n").map((line) => line.trim());
  assert(rollbackLines[0] === "t" && rollbackLines[1] === "4", `rollback left a pending object:\n${afterRollback.stdout}`);

  const applied = psql(`BEGIN;\n\\i ${bundlePath}\nCOMMIT;\n`);
  assert(applied.status === 0, applied.stderr);
  const defs = psql(`
    select pronargs from pg_proc where proname = 'start_session' and pronamespace = 'public'::regnamespace;
    select (prosrc like '%unique_violation%' and prosrc like '%person_id <> v_person%')
    from pg_proc where proname = 'start_session' and pronamespace = 'public'::regnamespace;
    select position('certainventures' in prosrc) = 0
    from pg_proc where proname = 'preview_ops_notification';
  `, true, true);
  const defLines = defs.stdout.trim().split("\n").map((line) => line.trim());
  assert(defLines[0] === "5" && defLines[1] === "t" && defLines[2] === "t", `final definitions:\n${defs.stdout}`);

  const gate = psql(`
    create or replace function public._test_hold_start() returns trigger
    language plpgsql security definer set search_path = public as $$
    begin
      perform pg_advisory_lock(8675309);
      perform pg_advisory_unlock(8675309);
      return new;
    end $$;
    drop trigger if exists _test_hold_start on public.service_sessions;
    create trigger _test_hold_start before insert on public.service_sessions
    for each row execute function public._test_hold_start();
  `);
  assert(gate.status === 0, gate.stderr);

  const site = psql(`select id from public.sites where name = 'Mount Sinai Hospital';`);
  const siteId = site.stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  assert(siteId, "Sinai was not seeded");
  const tech = "22222222-2222-4222-8222-222222222222";
  const other = "44444444-4444-4444-8444-444444444444";
  const admin = "11111111-1111-4111-8111-111111111111";
  psql(`
    insert into public.people (id, auth_user_id, full_name, goes_by, role, active, mode) values
      ('${admin}', '${admin}', 'Admin Example', 'Admin', 'admin', true, 'live'),
      ('${tech}', '${tech}', 'Tech Example', 'Tech', 'tech', true, 'live'),
      ('${other}', '${other}', 'Other Example', 'Other', 'tech', true, 'live');
    insert into public.person_sites (person_id, site_id) values
      ('${tech}', '${siteId}'), ('${other}', '${siteId}');
  `);

  async function callStart(client: InstanceType<typeof Client>, userId: string, sessionId: string, when: string) {
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
      const result = await client.query(
        "SELECT public.start_session($1::uuid, $2::uuid, $3::timestamptz, false, true) AS row",
        [sessionId, siteId, when],
      );
      await client.query("COMMIT");
      return { ok: true as const, row: result.rows[0].row as { person_id: string; checklist_snapshot: { photo_audit?: { required?: boolean } } } };
    } catch (err) {
      await client.query("ROLLBACK");
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async function waitForLock() {
    for (let i = 0; i < 50; i += 1) {
      const waiting = await holder.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");
      if (waiting.rows[0].n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("the second connection did not reach the insert lock");
  }

  const holder = new Client({ connectionString: databaseUrl });
  const otherConn = new Client({ connectionString: databaseUrl });
  await holder.connect();
  await otherConn.connect();
  await holder.query("SELECT pg_advisory_lock(8675309)");
  const sharedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const loser = callStart(otherConn, other, sharedId, "2026-11-28T15:00:00Z");
  await waitForLock();
  const winner = await callStart(holder, tech, sharedId, "2026-11-28T15:00:00Z");
  await holder.query("SELECT pg_advisory_unlock(8675309)");
  const lost = await loser;
  assert(winner.ok, `owner start failed: ${winner.ok ? "" : winner.message}`);
  assert(!lost.ok && lost.message.includes("Not allowed"), `the other person received the visit: ${JSON.stringify(lost)}`);
  const count = psql(`select count(*) from public.service_sessions where id = '${sharedId}';`, true, true);
  assert(count.stdout.trim() === "1", "the race created more than one visit");
  assert(winner.row.person_id === tech, "the stored visit is not the first person's");
  assert(winner.row.checklist_snapshot.photo_audit?.required === true, "the winning insert lost its photo requirement");
  psql(`update public.service_sessions set status = 'voided' where id = '${sharedId}';`);

  await holder.query("SELECT pg_advisory_lock(8675309)");
  const retryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const sameLoser = callStart(otherConn, tech, retryId, "2026-11-29T15:00:00Z");
  await waitForLock();
  const sameWinner = await callStart(holder, tech, retryId, "2026-11-29T15:00:00Z");
  await holder.query("SELECT pg_advisory_unlock(8675309)");
  const sameLost = await sameLoser;
  assert(sameWinner.ok && sameLost.ok, `a same-person retry was rejected: ${JSON.stringify(sameLost)}`);
  assert(sameLost.row.checklist_snapshot.photo_audit?.required === true, "the retry changed the photo requirement");
  const retryCount = psql(`select count(*) from public.service_sessions where id = '${retryId}';`, true, true);
  assert(retryCount.stdout.trim() === "1", "the same-person race created two visits");
  await otherConn.end();
  await holder.end();

  console.log(`Bundle ${bundleName} ${bundleSha}`);
  for (const part of bodies) console.log(`${part.name} ${part.sha256}`);
  console.log("Rollback removed the partial apply. Two-connection race denied the other person. Same-person retry kept one visit.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
