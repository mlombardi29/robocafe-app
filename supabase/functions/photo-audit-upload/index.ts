import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";
import { driveFileIdOk, driveFolderFor, type DriveKind } from "../_shared/driveRelay.ts";
import { serviceClient } from "../_shared/supabase.ts";

// Builds one allowlisted Drive upload. With the relay secrets unset it returns
// stored:false and does not call Google. This repository does not deploy it.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json(req, 405, { configured: false, stored: false, error: "Method not allowed." });
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return json(req, 401, { configured: false, stored: false, error: "Sign in again." });
  }

  const relay = Deno.env.get("DRIVE_RELAY_URL") ?? "";
  const relayToken = Deno.env.get("DRIVE_RELAY_TOKEN") ?? "";
  if (!relay || !relayToken) {
    return json(req, 503, { configured: false, stored: false, error: "Drive relay is not configured." });
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anon) return json(req, 503, { configured: false, stored: false, error: "Sign-in is not configured." });
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: header } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = header.slice(header.indexOf(" ") + 1).trim();
  const user = await userClient.auth.getUser(token);
  if (user.error || !user.data.user) return json(req, 401, { configured: true, stored: false, error: "Sign in again." });
  const person = await userClient.from("people").select("id, role, mode").eq("auth_user_id", user.data.user.id).maybeSingle();
  if (person.error || !person.data || (person.data.role !== "admin" && person.data.role !== "tech")) {
    return json(req, 403, { configured: true, stored: false, error: "Not allowed." });
  }

  let body: { kind?: DriveKind; parts?: string[]; idempotencyKey?: string; base64?: string; name?: string; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { configured: true, stored: false, error: "Missing details." });
  }
  if (body.kind === "backup") return json(req, 403, { configured: true, stored: false, error: "Backups are not turned on." });
  if (body.kind !== "photo_audit" && body.kind !== "receipt") {
    return json(req, 400, { configured: true, stored: false, error: "That upload is not allowed." });
  }
  const folder = driveFolderFor(body.kind, body.parts ?? []);
  if (!folder) return json(req, 400, { configured: true, stored: false, error: "That folder is not allowed." });
  const key = body.idempotencyKey ?? "";
  if (!/^[A-Za-z0-9-]{16,80}$/.test(key)) return json(req, 400, { configured: true, stored: false, error: "Missing save id." });

  if (body.kind === "photo_audit") {
    const shot = await userClient.from("photo_audit_shots").select("id, person_id, is_sandbox").eq("id", key).maybeSingle();
    if (shot.error || !shot.data || shot.data.person_id !== person.data.id) {
      return json(req, 403, { configured: true, stored: false, error: "Not allowed." });
    }
    if ((person.data.mode === "practice") !== shot.data.is_sandbox) {
      return json(req, 403, { configured: true, stored: false, error: "Switch Practice mode so it matches this visit." });
    }
  } else {
    const session = await userClient.from("service_sessions").select("id, person_id, is_sandbox").eq("id", body.sessionId ?? "").maybeSingle();
    if (session.error || !session.data || session.data.person_id !== person.data.id) {
      return json(req, 403, { configured: true, stored: false, error: "Not allowed." });
    }
    if ((person.data.mode === "practice") !== session.data.is_sandbox) {
      return json(req, 403, { configured: true, stored: false, error: "Switch Practice mode so it matches this visit." });
    }
  }

  const response = await fetch(relay, {
    method: "POST",
    headers: { "content-type": "application/json", "x-relay-token": relayToken },
    body: JSON.stringify({
      kind: body.kind,
      parts: body.parts,
      idempotencyKey: key,
      base64: body.base64,
      name: body.name,
    }),
  });
  const payload = await response.json().catch(() => ({ ok: false }));
  const fileId = typeof payload.fileId === "string" ? payload.fileId : "";
  if (!response.ok || payload.ok !== true || !driveFileIdOk(fileId)) {
    return json(req, 502, { configured: true, stored: false, error: "Drive did not store the file." });
  }
  if (body.kind === "photo_audit") {
    const ack = await serviceClient().rpc("record_drive_ack", { p_id: key, p_file: fileId });
    if (ack.error) return json(req, 502, { configured: true, stored: false, error: "Drive did not confirm this file." });
  }
  return json(req, 200, { configured: true, stored: true, fileId, replayed: Boolean(payload.replayed) });
});
