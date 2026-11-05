/** Allow the local app and the private Netlify test site. Echo the request origin. */

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const extra = (Deno.env.get("ALLOWED_ORIGIN") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const allowed =
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin) ||
    extra.includes(origin);

  const headers: Record<string, string> = {
    "access-control-allow-headers": "authorization, apikey, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "origin",
  };
  if (allowed && origin) headers["access-control-allow-origin"] = origin;
  return headers;
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(req) },
  });
}
