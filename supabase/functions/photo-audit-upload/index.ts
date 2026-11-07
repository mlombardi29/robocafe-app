import { json, preflight } from "../_shared/cors.ts";

// Forwards one photo to a Drive relay. It does not store the bytes itself.
// Without DRIVE_RELAY_URL and DRIVE_RELAY_TOKEN it reports that upload is not configured.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json(req, 405, { configured: false, error: "Method not allowed." });

  const header = req.headers.get("authorization") ?? "";
  if (!header) return json(req, 401, { configured: false, error: "Sign in again." });

  const relay = Deno.env.get("DRIVE_RELAY_URL") ?? "";
  const token = Deno.env.get("DRIVE_RELAY_TOKEN") ?? "";
  if (!relay || !token) {
    return json(req, 503, { configured: false, error: "Drive relay is not configured." });
  }

  const response = await fetch(relay, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-user-authorization": header,
    },
    body: req.body,
  });
  const body = await response.json().catch(() => ({ error: "Drive relay did not answer." }));
  if (!response.ok) {
    const message = typeof body === "object" && body && "error" in body ? String(body.error) : "Drive upload failed.";
    return json(req, response.status, { configured: true, error: message });
  }
  return json(req, 200, { configured: true, ...(body as object) });
});
