import bcrypt from "npm:bcryptjs@2.4.3";
import { json, preflight } from "../_shared/cors.ts";
import { pinError } from "../_shared/pinPolicy.ts";
import { anonClient, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed." });

  const header = req.headers.get("authorization") ?? "";
  const userClient = anonClient();
  const { data: userData, error: userError } = await userClient.auth.getUser(header.replace(/^Bearer\s+/i, ""));
  if (userError || !userData.user) return json(req, 401, { error: "Sign in again." });

  let body: { current_pin?: string; new_pin?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "Enter a new PIN." });
  }

  const problem = pinError(body.new_pin ?? "");
  if (problem) return json(req, 400, { error: problem });

  const admin = serviceClient();
  const { data: person } = await admin
    .from("people")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .eq("active", true)
    .maybeSingle();
  if (!person) return json(req, 403, { error: "Not allowed." });

  const { data: pinRow } = await admin
    .from("auth_pins")
    .select("pin_hash, must_change")
    .eq("person_id", person.id)
    .maybeSingle();
  if (!pinRow) return json(req, 403, { error: "Not allowed." });

  if (!pinRow.must_change) {
    if (!body.current_pin || !bcrypt.compareSync(body.current_pin, pinRow.pin_hash)) {
      return json(req, 401, { error: "The current PIN does not match." });
    }
  }
  if (bcrypt.compareSync(body.new_pin ?? "", pinRow.pin_hash)) {
    return json(req, 400, { error: "Choose a different PIN." });
  }

  const { error } = await admin
    .from("auth_pins")
    .update({
      pin_hash: bcrypt.hashSync(body.new_pin ?? "", 10),
      must_change: false,
      failed_count: 0,
      locked_until: null,
      changed_at: new Date().toISOString(),
    })
    .eq("person_id", person.id);
  if (error) return json(req, 500, { error: "Could not save the PIN." });
  return json(req, 200, { ok: true, must_change_pin: false });
});
