import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { APP_ENV: "staging", ADMIN_PUBLISHERS: "owner@example.com", DEV_AUTH_BYPASS: "true" } as Record<string, string>,
  authenticate: vi.fn()
}));
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("./lib/env", () => ({ getEnv: () => mocks.env }));
vi.mock("@frip-fan/core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@frip-fan/core")>(),
  authenticateAdmin: mocks.authenticate
}));
import { onRequest } from "./middleware";

async function request(path = "/") {
  const req = new Request(`https://staging.fripsi.de${path}`);
  const next = vi.fn(async () => new Response("private content", { headers: { "content-type": "text/html" } }));
  const response = await onRequest({ request: req, url: new URL(req.url), locals: {} } as Parameters<typeof onRequest>[0], next);
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
});
