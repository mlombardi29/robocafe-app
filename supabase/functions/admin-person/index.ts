import bcrypt from "npm:bcryptjs@2.4.3";
import { json, preflight } from "../_shared/cors.ts";
import { pinError } from "../_shared/pinPolicy.ts";
import { anonClient, randomPassword, serviceClient } from "../_shared/supabase.ts";

type Payload = {
  action?: string;
  full_name?: string;
  goes_by?: string;
  email?: string;
  phone?: string;
  role?: string;
  site_ids?: string[];
  temp_pin?: string;
  person_id?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed." });

  const header = req.headers.get("authorization") ?? "";
  const userClient = anonClient();
  const { data: userData } = await userClient.auth.getUser(header.replace(/^Bearer\s+/i, ""));
  if (!userData.user) return json(req, 401, { error: "Sign in again." });

  const admin = serviceClient();
  const { data: caller } = await admin
    .from("people")
    .select("id, role, active")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (!caller?.active || caller.role !== "admin") return json(req, 403, { error: "Not allowed." });

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "Missing details." });
  }

  try {
    if (body.action === "create") return json(req, 200, await createPerson(admin, body));
    if (body.action === "reset_pin") return json(req, 200, await resetPin(admin, body));
    if (body.action === "unlock") return json(req, 200, await unlock(admin, body));
    if (body.action === "deactivate") return json(req, 200, await deactivate(admin, caller.id, body));
    if (body.action === "set_sites") return json(req, 200, await setSites(admin, body));
    if (body.action === "set_role") return json(req, 200, await setRole(admin, caller.id, body));
    return json(req, 400, { error: "Unknown action." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save.";
    const status = /already|PIN|name|role|site/i.test(message) ? 400 : 500;
    return json(req, status, { error: message });
  }
});

async function createPerson(admin: ReturnType<typeof serviceClient>, body: Payload) {
  const role = body.role ?? "";
  if (!["admin", "tech", "trainee", "visitor"].includes(role)) throw new Error("Choose a role.");
  const fullName = (body.full_name ?? "").trim();
  const goesBy = (body.goes_by ?? "").trim() || fullName.split(" ")[0] || "";
  const email = (body.email ?? "").trim().toLowerCase();
  if (!fullName || !goesBy || !email.includes("@")) throw new Error("Name and email are required.");
  const problem = pinError(body.temp_pin ?? "");
  if (problem) throw new Error(problem);

  const personId = crypto.randomUUID();
  const synthetic = `p-${personId}@users.kioskops.invalid`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: synthetic,
    password: randomPassword(),
    email_confirm: true,
    app_metadata: { role },
  });
  if (createError || !created.user) throw new Error("Could not create the sign-in.");

  const { error: personError } = await admin.from("people").insert({
    id: personId,
    auth_user_id: created.user.id,
    full_name: fullName,
    goes_by: goesBy,
    email,
    phone: (body.phone ?? "").trim() || null,
    role,
    active: true,
    mode: role === "trainee" ? "practice" : "live",
  });
  if (personError) {
    await admin.auth.admin.deleteUser(created.user.id);
    if (/duplicate|unique/i.test(personError.message)) throw new Error("That email is already in use.");
    throw new Error("Could not save the person.");
  }

  await linkSites(admin, personId, role, body.site_ids ?? []);
  const { error: pinErrorSave } = await admin.from("auth_pins").insert({
    person_id: personId,
    pin_hash: bcrypt.hashSync(body.temp_pin ?? "", 10),
    must_change: true,
    failed_count: 0,
    locked_until: null,
  });
  if (pinErrorSave) throw new Error("Could not save the temporary PIN.");

  if (role === "trainee") {
    const { data: models } = await admin.from("models").select("id");
    if (models?.length) {
      await admin.from("training_progress").insert(
        models.map((model) => ({ person_id: personId, model_id: model.id, status: "in_training" })),
      );
    }
  }

  return { person_id: personId, goes_by: goesBy, must_change_pin: true };
}

async function linkSites(admin: ReturnType<typeof serviceClient>, personId: string, role: string, siteIds: string[]) {
  const ids = new Set(siteIds.filter(Boolean));
  if (role === "trainee") {
    const { data: sandbox } = await admin.from("sites").select("id").eq("is_sandbox", true);
    for (const site of sandbox ?? []) ids.add(site.id);
  }
  await admin.from("person_sites").delete().eq("person_id", personId);
  if (ids.size === 0) return;
  const { error } = await admin.from("person_sites").insert([...ids].map((site_id) => ({ person_id: personId, site_id })));
  if (error) throw new Error("Could not assign sites.");
}

async function resetPin(admin: ReturnType<typeof serviceClient>, body: Payload) {
  const problem = pinError(body.temp_pin ?? "");
  if (problem) throw new Error(problem);
  if (!body.person_id) throw new Error("Choose a person.");
  const { error } = await admin
    .from("auth_pins")
    .update({
      pin_hash: bcrypt.hashSync(body.temp_pin ?? "", 10),
      must_change: true,
      failed_count: 0,
      locked_until: null,
      changed_at: new Date().toISOString(),
    })
    .eq("person_id", body.person_id);
  if (error) throw new Error("Could not reset the PIN.");
  return { ok: true, must_change_pin: true };
}

async function unlock(admin: ReturnType<typeof serviceClient>, body: Payload) {
  if (!body.person_id) throw new Error("Choose a person.");
  const { error } = await admin
    .from("auth_pins")
    .update({ failed_count: 0, locked_until: null })
    .eq("person_id", body.person_id);
  if (error) throw new Error("Could not unlock.");
  return { ok: true };
}

async function deactivate(admin: ReturnType<typeof serviceClient>, callerId: string, body: Payload) {
  if (!body.person_id) throw new Error("Choose a person.");
  if (body.person_id === callerId) throw new Error("You cannot deactivate yourself.");
  const { data: person } = await admin
    .from("people")
    .select("id, auth_user_id, active")
    .eq("id", body.person_id)
    .maybeSingle();
  if (!person) throw new Error("Person not found.");

  const { error } = await admin.from("people").update({ active: false }).eq("id", person.id);
  if (error) throw new Error("Could not deactivate.");

  if (person.auth_user_id) {
    await admin.auth.admin.updateUserById(person.auth_user_id, { ban_duration: "876000h" });
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    await fetch(`${url}/auth/v1/admin/users/${person.auth_user_id}/logout`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
  }

  const { data: links } = await admin
    .from("person_sites")
    .select("site_id, sites(name, is_sandbox)")
    .eq("person_id", person.id);
  const titles = ["TODO: Confirm this person can no longer sign in."];
  const live = (links ?? []).filter((row) => {
    const site = row.sites as { name?: string; is_sandbox?: boolean } | null;
    return site && site.is_sandbox === false;
  });
  if (live.length === 0) {
    titles.push("TODO: Confirm whether they had any site codes. Codes are not stored in the app yet.");
  }
  for (const row of live) {
    const name = (row.sites as { name: string }).name;
    titles.push(`TODO: Rotate the kiosk lockbox code for ${name}. Codes are not stored in the app yet.`);
    titles.push(`TODO: Rotate the fridge combo for ${name}. Codes are not stored in the app yet.`);
    titles.push(`TODO: Rotate the building lockbox code for ${name}. Codes are not stored in the app yet.`);
  }
  await admin.from("offboarding_tasks").insert(
    titles.map((title) => ({ person_id: person.id, title, done: false })),
  );
  return { ok: true, tasks: titles.length };
}

async function setSites(admin: ReturnType<typeof serviceClient>, body: Payload) {
  if (!body.person_id) throw new Error("Choose a person.");
  const { data: person } = await admin.from("people").select("role").eq("id", body.person_id).maybeSingle();
  if (!person) throw new Error("Person not found.");
  await linkSites(admin, body.person_id, person.role, body.site_ids ?? []);
  return { ok: true };
}

async function setRole(admin: ReturnType<typeof serviceClient>, callerId: string, body: Payload) {
  if (!body.person_id || !body.role) throw new Error("Choose a person and a role.");
  if (body.person_id === callerId) throw new Error("You cannot change your own role.");
  if (!["admin", "tech", "trainee", "visitor"].includes(body.role)) throw new Error("Choose a role.");
  const patch: { role: string; mode?: string } = { role: body.role };
  if (body.role !== "trainee") patch.mode = "live";
  const { error } = await admin.from("people").update(patch).eq("id", body.person_id);
  if (error) throw new Error("Could not change the role.");
  if (body.role === "trainee") await linkSites(admin, body.person_id, "trainee", []);
  return { ok: true };
}
