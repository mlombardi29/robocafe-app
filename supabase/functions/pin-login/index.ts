import bcrypt from "npm:bcryptjs@2.4.3";
import { json } from "../_shared/cors.ts";
import { ipBlocked, minutesLeft, registerFailure } from "../_shared/pinPolicy.ts";
import { anonClient, hashIp, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: json(req, 204, {}).headers });
  if (req.method === "GET") return listNames(req);
  if (req.method === "POST") return signIn(req);
  return json(req, 405, { error: "Method not allowed." });
});

async function listNames(req: Request): Promise<Response> {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("people")
    .select("id, goes_by")
    .eq("active", true)
    .order("goes_by");
  if (error) return json(req, 500, { error: "Names are unavailable." });
  return json(
    req,
    200,
    (data ?? []).map((row) => ({ id: row.id, goes_by: row.goes_by })),
  );
}

async function signIn(req: Request): Promise<Response> {
  const admin = serviceClient();
  let body: { person_id?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "Sign-in failed." });
  }
  const personId = body.person_id ?? "";
  const pin = body.pin ?? "";
  const ipHash = await hashIp(req);
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { count } = await admin
    .from("login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("ok", false)
    .gte("at", since);
  if (ipBlocked(count ?? 0)) {
    await admin.from("login_attempts").insert({ ip_hash: ipHash, person_id: personId || null, ok: false });
    return json(req, 429, { error: "Too many attempts. Try again later." });
  }

  const { data: person } = await admin
    .from("people")
    .select("id, auth_user_id, active")
    .eq("id", personId)
    .maybeSingle();
  const { data: pinRow } = await admin
    .from("auth_pins")
    .select("pin_hash, must_change, failed_count, locked_until")
    .eq("person_id", personId)
    .maybeSingle();

  if (!person?.active || !person.auth_user_id || !pinRow) {
    await admin.from("login_attempts").insert({ ip_hash: ipHash, person_id: personId || null, ok: false });
    return json(req, 401, { error: "That PIN does not match." });
  }

  const lockedUntil = pinRow.locked_until ? new Date(pinRow.locked_until).getTime() : null;
  if (lockedUntil != null && lockedUntil > Date.now()) {
    await admin.from("login_attempts").insert({ ip_hash: ipHash, person_id: personId, ok: false });
    return json(req, 423, {
      error: "This name is locked.",
      minutes_left: minutesLeft(lockedUntil, Date.now()),
    });
  }

  const match = bcrypt.compareSync(pin, pinRow.pin_hash);
  if (!match) {
    const next = registerFailure(
      { failedCount: pinRow.failed_count ?? 0, lockedUntil },
      Date.now(),
    );
    await admin
      .from("auth_pins")
      .update({
        failed_count: next.failedCount,
        locked_until: next.lockedUntil ? new Date(next.lockedUntil).toISOString() : null,
      })
      .eq("person_id", personId);
    await admin.from("login_attempts").insert({ ip_hash: ipHash, person_id: personId, ok: false });
    if (next.lockedUntil) {
      return json(req, 423, {
        error: "This name is locked.",
        minutes_left: minutesLeft(next.lockedUntil, Date.now()),
      });
    }
    return json(req, 401, { error: "That PIN does not match." });
  }

  await admin
    .from("auth_pins")
    .update({ failed_count: 0, locked_until: null })
    .eq("person_id", personId);
  await admin.from("login_attempts").insert({ ip_hash: ipHash, person_id: personId, ok: true });

  const { data: authUser, error: userError } = await admin.auth.admin.getUserById(person.auth_user_id);
  if (userError || !authUser.user?.email) return json(req, 500, { error: "Sign-in failed." });

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: authUser.user.email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) return json(req, 500, { error: "Sign-in failed." });

  const anon = anonClient();
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyError || !verified.session) return json(req, 500, { error: "Sign-in failed." });

  return json(req, 200, {
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
    must_change_pin: pinRow.must_change === true,
  });
}
