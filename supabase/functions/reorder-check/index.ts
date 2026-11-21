import { json, preflight } from "../_shared/cors.ts";

// Asks preview_reorder to record a held list. This function never sends email.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed." });

  const header = req.headers.get("authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!header || !url || !key) return json(req, 401, { error: "Sign in again." });

  const response = await fetch(`${url}/rest/v1/rpc/preview_reorder`, {
    method: "POST",
    headers: {
      authorization: header,
      apikey: key,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_day: null }),
  });
  const body = await response.json().catch(() => ({ error: "Reorder check failed." }));
  if (!response.ok) {
    const message = typeof body === "object" && body && "message" in body ? String(body.message) : "Reorder check failed.";
    return json(req, response.status, { error: message, sent: false });
  }
  return json(req, 200, { ...(body as object), sent: false });
});
