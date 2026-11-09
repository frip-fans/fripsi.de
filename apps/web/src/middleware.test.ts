import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { APP_ENV: "staging", ADMIN_PUBLISHERS: "owner@example.com", DEV_AUTH_BYPASS: "true" } as Record<string, string>,
  authenticate: vi.fn()
}));
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("./lib/env", () => ({ getEnv: () => mocks.env }));
// The public response cache has its own tests; here it passes every request straight through.
vi.mock("#public-cache", () => ({ publicResponse: (_key: string, next: () => Promise<Response>) => next() }));
vi.mock("@frip-fan/core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@frip-fan/core")>(),
  authenticateAdmin: mocks.authenticate
}));
import { onRequest } from "./middleware";

async function request(path = "/", init?: ResponseInit & { status?: number }) {
  const req = new Request(`https://staging.fripsi.de${path}`);
  const next = vi.fn(async () => new Response("private content", { headers: { "content-type": "text/html" }, ...init }));
  const response = await onRequest({ request: req, url: new URL(req.url), locals: {}, cookies: { get: () => undefined } } as unknown as Parameters<typeof onRequest>[0], next);
  if (!(response instanceof Response)) throw new Error("Middleware did not return a response");
  return { response, next };
}

describe("staging access isolation", () => {
  beforeEach(() => {
    mocks.env.APP_ENV = "staging";
    mocks.authenticate.mockReset();
  });
  it("blocks unauthenticated public pages before rendering", async () => {
    mocks.authenticate.mockRejectedValue(new Error("Login required"));
    const { response, next } = await request();
    expect(response.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.authenticate.mock.calls[0][1].DEV_AUTH_BYPASS).toBe("false");
  });
  it("rejects an authenticated identity outside the staging allowlist", async () => {
    mocks.authenticate.mockResolvedValue({ id: "other@example.com" });
    const { response, next } = await request("/calendar.ics");
    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
  it("serves the owner with map CSP, no caching and no indexing", async () => {
    mocks.authenticate.mockResolvedValue({ id: "owner@example.com" });
    const { response, next } = await request("/journey");
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
    expect(response.headers.get("content-security-policy")).toContain("https://tiles.openfreemap.org");
    expect(response.headers.get("content-security-policy")).not.toContain("https://giscus.app");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("keeps production public pages accessible without login", async () => {
    mocks.env.APP_ENV = "production";
    const { response, next } = await request();
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(response.headers.has("x-robots-tag")).toBe(false);
  });
  it.each(["/about", "/calendar", "/music/lives"])("allows Giscus after client navigation from %s", async path => {
    mocks.env.APP_ENV = "production";
    const { response } = await request(path);
    const policy = response.headers.get("content-security-policy")!;
    expect(policy).toMatch(/script-src [^;]*https:\/\/giscus\.app/);
    expect(policy).toMatch(/frame-src [^;]*https:\/\/giscus\.app/);
  });
  it("keeps Giscus disabled for admin documents", async () => {
    mocks.env.APP_ENV = "production";
    mocks.authenticate.mockResolvedValue({ id: "owner@example.com" });
    const { response } = await request("/admin");
    expect(response.headers.get("content-security-policy")).not.toContain("https://giscus.app");
  });
  it("keeps list view caching private after moving the archive under calendar", async () => {
    mocks.env.APP_ENV = "production";
    const { response } = await request("/calendar?view=list&year=2025");
    expect(response.headers.get("cache-control")).toBe("private, max-age=60, stale-while-revalidate=30");
  });

  it("lets a prefetch and the back button reuse a public document, never a shared cache", async () => {
    mocks.env.APP_ENV = "production";
    for (const path of ["/", "/about", "/calendar?view=calendar", "/music/lives"]) {
      const { response } = await request(path);
      expect(response.headers.get("cache-control"), path).toBe("private, max-age=60, stale-while-revalidate=30");
      expect(response.headers.get("vary"), path).toContain("Cookie");
    }
  });

  it("leaves responses that carry their own policy, an error or state uncached", async () => {
    mocks.env.APP_ENV = "production";
    const own = await request("/about", { headers: { "content-type": "text/html", "cache-control": "no-store" } });
    expect(own.response.headers.get("cache-control")).toBe("no-store");
    const health = await request("/healthz", { headers: { "content-type": "application/json", "cache-control": "no-store" } });
    expect(health.response.headers.get("cache-control")).toBe("private, no-store");
    const missing = await request("/nope", { status: 404, headers: { "content-type": "text/html" } });
    expect(missing.response.headers.has("cache-control")).toBe(false);
    const stateful = await request("/", { headers: { "content-type": "text/html", "set-cookie": "a=1" } });
    expect(stateful.response.headers.has("cache-control")).toBe(false);
    const feed = await request("/calendar.ics", { headers: { "content-type": "text/calendar" } });
    expect(feed.response.headers.has("cache-control")).toBe(false);
  });

  it("keeps every admin document out of any cache", async () => {
    mocks.env.APP_ENV = "production";
    mocks.authenticate.mockResolvedValue({ id: "owner@example.com" });
    const { response } = await request("/admin/events");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

});
