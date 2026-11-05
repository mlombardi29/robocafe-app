/**
 * Create the first admin. Run by a developer with the service role key in the
 * environment. Do not commit the key or the temporary PIN.
 *
 *   cd app
 *   SUPABASE_URL=https://ucvacwbmhutedwfffcoj.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   ADMIN_FULL_NAME="Michael Lombardi" \
 *   ADMIN_GOES_BY="Michael" \
 *   ADMIN_EMAIL="michael@certainventures.ca" \
 *   ADMIN_PHONE="" \
 *   ADMIN_TEMP_PIN=... \
 *   npx tsx ../scripts/bootstrap-admin.ts
 *
 * Run it again for Kajsa. The temporary PIN is only printed as "set", never echoed.
 */
import { createRequire } from "node:module";
import { pinError } from "../supabase/functions/_shared/pinPolicy.ts";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const bcrypt = require("bcryptjs") as typeof import("bcryptjs");

const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const fullName = (process.env.ADMIN_FULL_NAME ?? "").trim();
const goesBy = (process.env.ADMIN_GOES_BY ?? "").trim();
const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const phone = (process.env.ADMIN_PHONE ?? "").trim();
const tempPin = process.env.ADMIN_TEMP_PIN ?? "";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!url || !key) fail("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
if (!fullName || !goesBy || !email.includes("@")) fail("Set ADMIN_FULL_NAME, ADMIN_GOES_BY, and ADMIN_EMAIL.");
const problem = pinError(tempPin);
if (problem) fail(problem);

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const personId = crypto.randomUUID();
const synthetic = `p-${personId}@users.kioskops.invalid`;
const bytes = new Uint8Array(32);
crypto.getRandomValues(bytes);
const password = btoa(String.fromCharCode(...bytes));

const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email: synthetic,
  password,
  email_confirm: true,
  app_metadata: { role: "admin" },
});
if (createError || !created.user) fail(createError?.message ?? "Could not create the auth user.");

const { error: personError } = await supabase.from("people").insert({
  id: personId,
  auth_user_id: created.user.id,
  full_name: fullName,
  goes_by: goesBy,
  email,
  phone: phone || null,
  role: "admin",
  active: true,
  mode: "live",
});
if (personError) {
  await supabase.auth.admin.deleteUser(created.user.id);
  fail(personError.message);
}

const { data: sites } = await supabase.from("sites").select("id").eq("is_sandbox", false);
if (sites?.length) {
  const { error: linkError } = await supabase.from("person_sites").insert(
    sites.map((site) => ({ person_id: personId, site_id: site.id })),
  );
  if (linkError) fail(linkError.message);
}

const { error: pinSaveError } = await supabase.from("auth_pins").insert({
  person_id: personId,
  pin_hash: bcrypt.hashSync(tempPin, 10),
  must_change: true,
  failed_count: 0,
});
if (pinSaveError) fail(pinSaveError.message);

console.log(`Admin ${goesBy} is ready. Temporary PIN is set and must be changed at first sign-in.`);
