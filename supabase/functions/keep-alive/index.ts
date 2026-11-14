import { json, preflight } from "../_shared/cors.ts";

/** Daily ping so the free project is less likely to pause. No database write. */
Deno.serve((req) => {
  if (req.method === "OPTIONS") return preflight(req);
  return json(req, 200, { ok: true });
});
