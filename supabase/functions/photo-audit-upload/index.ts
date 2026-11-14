import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";
import {
  contentKey,
  decodeBase64,
  driveFileIdOk,
  jpegBytes,
  MAX_RELAY_BYTES,
  serverFolder,
  sha256Hex,
  type DriveKind,
} from "../_shared/driveRelay.ts";
import { serviceClient } from "../_shared/supabase.ts";

// Builds one server-scoped Drive upload. With the relay secrets unset it returns
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
  const person = await userClient.from("people").select("id, role, mode, goes_by").eq("auth_user_id", user.data.user.id).maybeSingle();
  if (person.error || !person.data || (person.data.role !== "admin" && person.data.role !== "tech")) {
    return json(req, 403, { configured: true, stored: false, error: "Not allowed." });
  }

  let body: { kind?: DriveKind; parts?: string[]; folder?: string; idempotencyKey?: string; base64?: string; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { configured: true, stored: false, error: "Missing details." });
  }
  if ((body.parts && body.parts.length > 0) || body.folder) {
    return json(req, 400, { configured: true, stored: false, error: "That folder is not allowed." });
  }
  if (body.kind === "backup") return json(req, 403, { configured: true, stored: false, error: "Backups are not turned on." });
  if (body.kind !== "photo_audit" && body.kind !== "receipt") {
    return json(req, 400, { configured: true, stored: false, error: "That upload is not allowed." });
  }

  const bytes = decodeBase64(body.base64 ?? "");
  if (!bytes || bytes.length === 0 || bytes.length > MAX_RELAY_BYTES || !jpegBytes(bytes)) {
    return json(req, 400, { configured: true, stored: false, error: "That file is not allowed." });
  }
  const sha = await sha256Hex(bytes);

  let folder: string | null = null;
  let driveKey = "";
  let ack: { id: string; sha: string; bytes: number; version: number } | null = null;
  if (body.kind === "photo_audit") {
    const shot = await userClient
      .from("photo_audit_shots")
      .select("id, person_id, is_sandbox, session_id, shot_key, content_sha256, byte_size, content_version")
      .eq("id", body.idempotencyKey ?? "")
      .maybeSingle();
    if (shot.error || !shot.data || shot.data.person_id !== person.data.id) {
      return json(req, 403, { configured: true, stored: false, error: "Not allowed." });
    }
    if ((person.data.mode === "practice") !== shot.data.is_sandbox) {
      return json(req, 403, { configured: true, stored: false, error: "Switch Practice mode so it matches this visit." });
    }
    if (shot.data.content_sha256 !== sha || shot.data.byte_size !== bytes.length) {
      return json(req, 409, { configured: true, stored: false, error: "This photo changed before it was stored." });
    }
    const session = await userClient.from("service_sessions").select("id, site_id, service_date, is_sandbox").eq("id", shot.data.session_id).maybeSingle();
    const site = session.data ? await userClient.from("sites").select("short_name").eq("id", session.data.site_id).maybeSingle() : { data: null };
    const day = session.data?.service_date ?? "";
    folder = serverFolder("photo_audit", person.data.goes_by, day, site.data?.short_name ?? "");
    driveKey = contentKey(shot.data.id, shot.data.content_version, sha) ?? "";
    ack = { id: shot.data.id, sha, bytes: bytes.length, version: shot.data.content_version };
    if (!folder || !driveKey || session.data?.is_sandbox !== shot.data.is_sandbox) {
      return json(req, 400, { configured: true, stored: false, error: "That folder is not allowed." });
    }
  } else {
    const session = await userClient.from("service_sessions").select("id, person_id, is_sandbox, site_id, service_date").eq("id", body.sessionId ?? "").maybeSingle();
    if (session.error || !session.data || session.data.person_id !== person.data.id) {
      return json(req, 403, { configured: true, stored: false, error: "Not allowed." });
    }
    if ((person.data.mode === "practice") !== session.data.is_sandbox) {
      return json(req, 403, { configured: true, stored: false, error: "Switch Practice mode so it matches this visit." });
    }
    const site = await userClient.from("sites").select("short_name").eq("id", session.data.site_id).maybeSingle();
    folder = serverFolder("receipt", person.data.goes_by, session.data.service_date, site.data?.short_name ?? "");
    driveKey = contentKey(session.data.id, 1, sha) ?? "";
    if (!folder || !driveKey) return json(req, 400, { configured: true, stored: false, error: "That folder is not allowed." });
  }

  const response = await fetch(relay, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      relayToken,
      kind: body.kind,
      folder,
      idempotencyKey: driveKey,
      base64: body.base64,
      name: body.kind === "photo_audit" ? "photo.jpg" : "receipt.jpg",
    }),
  });
  const payload = await response.json().catch(() => ({ ok: false }));
  const fileId = typeof payload.fileId === "string" ? payload.fileId : "";
  if (!response.ok || payload.ok !== true || payload.key !== driveKey || !driveFileIdOk(fileId)) {
    return json(req, 502, { configured: true, stored: false, error: "Drive did not store the file." });
  }
  if (ack) {
    const recorded = await serviceClient().rpc("record_drive_ack", {
      p_id: ack.id,
      p_file: fileId,
      p_sha: ack.sha,
      p_bytes: ack.bytes,
      p_version: ack.version,
    });
    if (recorded.error) return json(req, 502, { configured: true, stored: false, error: "Drive did not confirm this file." });
  }
  return json(req, 200, { configured: true, stored: true, fileId, replayed: Boolean(payload.replayed) });
});
