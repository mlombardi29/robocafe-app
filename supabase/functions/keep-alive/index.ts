import { json } from "../_shared/cors.ts";

/** Daily ping so the free project is less likely to pause. No database write. */
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: json(req, 204, {}).headers });
  return json(req, 200, { ok: true });
});
