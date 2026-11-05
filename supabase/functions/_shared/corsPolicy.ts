/**
 * Pure CORS rules for the edge functions. No Deno globals, so Vitest can import this.
 * Browser preflight must be answered with status 204 and an empty body. A 204 response
 * that includes a body throws, and the platform turns that into a 500.
 */

export const DEFAULT_ALLOW_HEADERS = [
  "authorization",
  "apikey",
  "content-type",
  "accept",
  "prefer",
  "accept-profile",
  "content-profile",
  "x-client-info",
  "x-supabase-api-version",
];

export function isAllowedOrigin(origin: string, extraOrigins: string[] = []): boolean {
  if (!origin) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  // Site URL, branch deploys, and deploy previews (deploy-preview-2--site.netlify.app).
  if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin)) return true;
  return extraOrigins.includes(origin);
}

export function allowHeaders(requestHeaders: string | null): string {
  const requested = (requestHeaders ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ALLOW_HEADERS, ...requested])].join(", ");
}

export function preflightHeaders(input: {
  origin: string | null;
  requestHeaders: string | null;
  extraOrigins?: string[];
}): Record<string, string> {
  const origin = input.origin ?? "";
  const headers: Record<string, string> = {
    "access-control-allow-headers": allowHeaders(input.requestHeaders),
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
    vary: "origin, access-control-request-headers",
  };
  if (isAllowedOrigin(origin, input.extraOrigins ?? [])) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}
