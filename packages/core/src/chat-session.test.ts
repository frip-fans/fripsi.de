/// <reference types="node" />
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { authenticateMcp } from "./auth";
import {
  CHAT_SESSION_TTL_SECONDS,
  activeChatSession,
  authenticateChatToken,
  attachChatSession,
  closeChatSession,
  openChatSession,
  signChatToken,
} from "./chat-session";
import { createTestD1 } from "./test-d1";
import { ServiceError } from "./utils";

const secret = "chat-signing-secret-that-is-long-enough";
const audience = "https://mcp.test.example/mcp";
const actor = "maintainer@example.com";
// jose validates exp/iat against the real clock, so the fixture tracks it.
const now = new Date();

let db: D1Database;
const env = () => ({ DB: db, AUTOMATION_SIGNING_SECRET: secret, AUTOMATION_AUDIENCE: audience });

async function open(id = "session-1", created = now): Promise<string> {
  await openChatSession(db, {
    id, actor_id: actor, model: "gpt-6-luna", budget_group: `chat:${actor}:fixture`,
    created_at: created.toISOString(),
    expires_at: new Date(created.valueOf() + CHAT_SESSION_TTL_SECONDS * 1000).toISOString(),
  });
  return signChatToken(secret, audience, id, actor, created.toISOString());
}

beforeEach(() => { db = createTestD1().db; });

describe("chat credentials", () => {
  it("resolves the signed-in maintainer without publish capability", async () => {
    const resolved = await authenticateChatToken(await open(), env(), now);
    expect(resolved).toMatchObject({ id: actor, type: "ai", channel: "mcp" });
    expect(resolved.scopes).toEqual(["events:read", "events:draft"]);
  });

  it("ignores publish scopes claimed inside the token", async () => {
    const issuedAt = Math.floor(now.valueOf() / 1000);
    await open();
    const forged = `fchat.${await new SignJWT({ chat_session_id: "session-1", scopes: ["events:publish", "events:archive"] })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("fripsi:admin-chat").setAudience(audience).setSubject(actor)
      .setIssuedAt(issuedAt).setExpirationTime(issuedAt + CHAT_SESSION_TTL_SECONDS)
      .sign(new TextEncoder().encode(secret))}`;
    const resolved = await authenticateChatToken(forged, env(), now);
    expect(resolved.scopes).not.toContain("events:publish");
    expect(resolved.scopes).not.toContain("events:archive");
  });

  it("rejects another audience, another signer and an expired credential", async () => {
    const token = await open();
    await expect(authenticateChatToken(token, { ...env(), AUTOMATION_AUDIENCE: "https://other.example/mcp" }, now))
      .rejects.toThrow(ServiceError);
    await expect(authenticateChatToken(token, { ...env(), AUTOMATION_SIGNING_SECRET: "another-secret-long-enough-here" }, now))
      .rejects.toThrow(ServiceError);
    await expect(authenticateChatToken(token, env(), new Date(now.valueOf() + (CHAT_SESSION_TTL_SECONDS + 60) * 1000)))
      .rejects.toThrow(ServiceError);
  });

  it("rejects a credential whose session is no longer active", async () => {
    const token = await open();
    await closeChatSession(db, "session-1", "closed", now);
    await expect(authenticateChatToken(token, env(), now)).rejects.toThrow(ServiceError);
  });

  it("rejects a credential presented for someone else's session", async () => {
    await open();
    const token = await signChatToken(secret, audience, "session-1", "intruder@example.com", now.toISOString());
    await expect(authenticateChatToken(token, env(), now)).rejects.toThrow(ServiceError);
  });

  it("refuses to run without a configured signing secret", async () => {
    const token = await open();
    await expect(authenticateChatToken(token, { DB: db, AUTOMATION_AUDIENCE: audience }, now)).rejects.toThrow(ServiceError);
  });

  it("is reachable through the MCP bearer path", async () => {
    const token = await open();
    const request = new Request("https://mcp.test.example/mcp", { headers: { Authorization: `Bearer ${token}` } });
    const resolved = await authenticateMcp(request, { ...env(), DEV_AUTH_BYPASS: "false" });
    expect(resolved.id).toBe(actor);
    expect(resolved.scopes).toEqual(["events:read", "events:draft"]);
  });
});

describe("chat sessions", () => {
  it("keeps one active session per maintainer", async () => {
    await open("session-1");
    await open("session-2", new Date(now.valueOf() + 1000));
    const active = await activeChatSession(db, actor, new Date(now.valueOf() + 2000));
    expect(active?.id).toBe("session-2");
    const first = await db.prepare("SELECT status FROM admin_chat_sessions WHERE id='session-1'").first<{ status: string }>();
    expect(first?.status).toBe("closed");
  });

  it("expires a session past its deadline instead of returning it", async () => {
    await open();
    const later = new Date(now.valueOf() + (CHAT_SESSION_TTL_SECONDS + 1) * 1000);
    expect(await activeChatSession(db, actor, later)).toBeNull();
    const row = await db.prepare("SELECT status FROM admin_chat_sessions WHERE id='session-1'").first<{ status: string }>();
    expect(row?.status).toBe("expired");
  });

  it("records the remote session id only while active", async () => {
    await open();
    await attachChatSession(db, "session-1", "agent-session-abc", now);
    expect((await activeChatSession(db, actor, now))?.agent_session_id).toBe("agent-session-abc");
    await closeChatSession(db, "session-1", "closed", now);
    await attachChatSession(db, "session-1", "agent-session-xyz", now);
    const row = await db.prepare("SELECT agent_session_id FROM admin_chat_sessions WHERE id='session-1'").first<{ agent_session_id: string }>();
    expect(row?.agent_session_id).toBe("agent-session-abc");
  });
});
