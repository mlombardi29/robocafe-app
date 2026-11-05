import { preflightHeaders } from "./corsPolicy.ts";

function extraOrigins(): string[] {
  const raw = typeof Deno === "undefined" ? "" : Deno.env.get("ALLOWED_ORIGIN") ?? "";
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  return preflightHeaders({
    origin: req.headers.get("origin"),
    requestHeaders: req.headers.get("access-control-request-headers"),
    extraOrigins: extraOrigins(),
  });
}

/** Empty 204. Do not pass a JSON body: status 204 forbids one and the constructor throws. */
export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(req) },
  });
}
