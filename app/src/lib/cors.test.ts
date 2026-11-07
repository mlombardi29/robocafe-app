import { describe, expect, it } from "vitest";
import { isAllowedOrigin, preflightHeaders } from "../../../supabase/functions/_shared/corsPolicy";

const staging = "https://sparkly-brioche-eb3506.netlify.app";

describe("OPTIONS preflight", () => {
  it("allows the staging site, deploy previews, and localhost", () => {
    expect(isAllowedOrigin(staging)).toBe(true);
    expect(isAllowedOrigin("https://deploy-preview-2--sparkly-brioche-eb3506.netlify.app")).toBe(true);
    expect(isAllowedOrigin("https://kioskops-v1--sparkly-brioche-eb3506.netlify.app")).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedOrigin("https://example.com")).toBe(false);
  });

  it("answers with 204, no body, and the headers supabase-js sends", () => {
    const headers = preflightHeaders({
      origin: staging,
      requestHeaders: "authorization, apikey, content-type, x-client-info",
    });
    expect(headers["access-control-allow-origin"]).toBe(staging);
    expect(headers["access-control-allow-methods"]).toMatch(/OPTIONS/);
    expect(headers["access-control-allow-headers"]).toMatch(/x-client-info/);
    expect(headers["access-control-allow-headers"]).toMatch(/x-supabase-api-version/);
    expect(headers["access-control-allow-headers"]).toMatch(/apikey/);

    const response = new Response(null, { status: 204, headers });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(staging);
  });

  it("does not build a 204 response that has a body", () => {
    expect(() => new Response("{}", { status: 204 })).toThrow();
  });
});
