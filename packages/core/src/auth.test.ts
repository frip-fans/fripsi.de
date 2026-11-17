import { beforeEach, describe, expect, it, vi } from "vitest";

// Signature checking belongs to jose; these tests decide what a verified payload is allowed to become.
const verified = vi.hoisted(() => ({ calls: [] as Array<{ issuer: string; audience: string }> }));
vi.mock("jose", () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async (token: string, _keys: unknown, options: { issuer: string; audience: string }) => {
    verified.calls.push(options);
    return { payload: JSON.parse(token) };
  },
}));
import { authenticateAdmin, authenticateMcp, isStagingAgent } from "./auth";

const base = { ACCESS_TEAM_DOMAIN: "team.example", ACCESS_AUD: "site-aud", MCP_AUDIENCE: "mcp-aud", ADMIN_PUBLISHERS: "owner@example.com" };
const staging = { ...base, APP_ENV: "staging", STAGING_SERVICE_CLIENTS: "other.access, agent-1.access" };
const serviceToken = { common_name: "agent-1.access", sub: "" };
const admin = (payload: object, env: object) =>
  authenticateAdmin(new Request("https://staging.example/admin", { headers: { "Cf-Access-Jwt-Assertion": JSON.stringify(payload) } }), env);
const mcp = (headers: Record<string, string>, env: object) =>
  authenticateMcp(new Request("https://staging.example/mcp", { method: "POST", headers }), env);

describe("staging test agent", () => {
  beforeEach(() => { verified.calls.length = 0; });

  it("turns an allowlisted service token into a publishing agent on staging", async () => {
    const actor = await admin(serviceToken, staging);
    expect(actor).toMatchObject({ id: "agent:agent-1.access", type: "ai", channel: "admin" });
    expect(actor.scopes).toEqual(expect.arrayContaining(["events:publish", "events:archive", "music:write"]));
    expect(isStagingAgent(actor)).toBe(true);
    expect(verified.calls).toEqual([{ issuer: "https://team.example", audience: "site-aud" }]);
  });

  it("ignores the allowlist everywhere but staging", async () => {
    for (const APP_ENV of ["production", "preview", undefined]) {
      const actor = await admin(serviceToken, { ...staging, APP_ENV });
      expect(actor).toMatchObject({ type: "human" });
      expect(actor.scopes).not.toContain("events:publish");
      expect(isStagingAgent(actor)).toBe(false);
    }
  });

  it("keeps service tokens that are not listed, and people, as they were", async () => {
    for (const payload of [{ common_name: "stranger.access", sub: "" }, { common_name: "", sub: "" }, { sub: "" }]) {
      const actor = await admin(payload, staging);
      expect(isStagingAgent(actor)).toBe(false);
      expect(actor.scopes).not.toContain("events:publish");
    }
    expect(isStagingAgent(await admin(serviceToken, { ...staging, STAGING_SERVICE_CLIENTS: "" }))).toBe(false);
    // An email wins: a person's token never becomes an agent, even carrying a listed common_name.
    const person = await admin({ email: "owner@example.com", common_name: "agent-1.access" }, staging);
    expect(person).toMatchObject({ id: "owner@example.com", type: "human" });
    expect(person.scopes).toContain("events:publish");
    expect(isStagingAgent({ id: "agent:someone", type: "human" })).toBe(false);
  });

  it("lets the agent call MCP through the Access-protected staging site only", async () => {
    const assertion = { "Cf-Access-Jwt-Assertion": JSON.stringify(serviceToken) };
    const actor = await mcp(assertion, staging);
    expect(actor).toMatchObject({ id: "agent:agent-1.access", type: "ai", channel: "mcp" });
    expect(actor.scopes).toContain("events:publish");
    expect(verified.calls).toEqual([{ issuer: "https://team.example", audience: "site-aud" }]);

    await expect(mcp(assertion, { ...staging, APP_ENV: "production" })).rejects.toMatchObject({ code: "unauthorized" });
    await expect(mcp(assertion, { ...staging, STAGING_SERVICE_CLIENTS: "other.access" })).rejects.toMatchObject({ code: "unauthorized" });
    await expect(mcp({ "Cf-Access-Jwt-Assertion": JSON.stringify({ email: "owner@example.com" }) }, staging)).rejects.toMatchObject({ code: "unauthorized" });
    await expect(mcp({}, staging)).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("leaves an OAuth bearer token on its own path", async () => {
    verified.calls.length = 0;
    const actor = await mcp({
      Authorization: `Bearer ${JSON.stringify({ email: "owner@example.com", scope: "events:read events:draft" })}`,
      "Cf-Access-Jwt-Assertion": JSON.stringify(serviceToken),
    }, staging);
    expect(actor).toMatchObject({ id: "owner@example.com", scopes: ["events:read", "events:draft"] });
    expect(verified.calls).toEqual([{ issuer: "https://team.example", audience: "mcp-aud" }]);
  });
});
