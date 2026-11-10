import { SignJWT, jwtVerify } from "jose";
import type { Actor } from "./types";
import { ServiceError } from "./utils";

const issuer = "fripsi:admin-chat";
const prefix = "fchat.";
/** A chat credential never carries publish, archive or music write capability. */
export const CHAT_SCOPES = ["events:read", "events:draft"] as const;
/** MCP credentials are fixed in the session's tool configuration and cannot be rotated mid-session. */
export const CHAT_SESSION_TTL_SECONDS = 1800;

export interface ChatSession {
  id: string;
  agent_session_id: string | null;
  actor_id: string;
  model: string;
  budget_group: string;
  status: "active" | "expired" | "closed";
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface ChatAuthEnv {
  DB?: D1Database;
  AUTOMATION_SIGNING_SECRET?: string;
  AUTOMATION_AUDIENCE?: string;
}

export function isChatToken(token: string): boolean {
  return token.startsWith(prefix);
}

export async function signChatToken(secret: string, audience: string, sessionId: string, subject: string, createdAt: string): Promise<string> {
  if (new TextEncoder().encode(secret).length < 32) throw new ServiceError("chat_config", "签名密钥至少需要 32 字节", 500);
  const issuedAt = Math.floor(Date.parse(createdAt) / 1000);
  return `${prefix}${await new SignJWT({ chat_session_id: sessionId }).setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer).setAudience(audience).setSubject(subject)
    .setIssuedAt(issuedAt).setExpirationTime(issuedAt + CHAT_SESSION_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret))}`;
}

/**
 * Verifies a chat credential and resolves the maintainer behind it. Scopes come from the
 * server-side constant, never from the token, so a forged or widened claim cannot publish.
 */
export async function authenticateChatToken(token: string, env: ChatAuthEnv, now = new Date()): Promise<Actor> {
  if (!env.DB || !env.AUTOMATION_AUDIENCE || !env.AUTOMATION_SIGNING_SECRET
    || new TextEncoder().encode(env.AUTOMATION_SIGNING_SECRET).length < 32) {
    throw new ServiceError("chat_config", "后台聊天身份未配置", 503);
  }
  try {
    const { payload } = await jwtVerify(token.slice(prefix.length), new TextEncoder().encode(env.AUTOMATION_SIGNING_SECRET), {
      algorithms: ["HS256"], issuer, audience: env.AUTOMATION_AUDIENCE,
      maxTokenAge: `${CHAT_SESSION_TTL_SECONDS}s`, requiredClaims: ["exp", "iat", "sub", "chat_session_id"],
    });
    if (typeof payload.chat_session_id !== "string" || typeof payload.sub !== "string") throw new Error("invalid_session");
    const session = await getChatSession(env.DB, payload.chat_session_id);
    if (!session || session.status !== "active" || session.actor_id !== payload.sub
      || Date.parse(session.expires_at) <= now.valueOf()) throw new Error("inactive_session");
    return { id: session.actor_id, type: "ai", channel: "mcp", scopes: [...CHAT_SCOPES] };
  } catch { throw new ServiceError("unauthorized", "聊天凭据无效、已过期或会话已结束", 401); }
}

export async function getChatSession(db: D1Database, id: string): Promise<ChatSession | null> {
  return db.prepare("SELECT * FROM admin_chat_sessions WHERE id = ?").bind(id).first<ChatSession>();
}

/** One active session per maintainer: opening a new one closes the previous. */
export async function openChatSession(db: D1Database, session: Omit<ChatSession, "status" | "updated_at" | "agent_session_id">): Promise<ChatSession> {
  await db.batch([
    db.prepare("UPDATE admin_chat_sessions SET status='closed',updated_at=? WHERE actor_id=? AND status='active'")
      .bind(session.created_at, session.actor_id),
    db.prepare(`INSERT INTO admin_chat_sessions (id,actor_id,model,budget_group,status,created_at,updated_at,expires_at)
      VALUES (?,?,?,?,'active',?,?,?)`)
      .bind(session.id, session.actor_id, session.model, session.budget_group, session.created_at, session.created_at, session.expires_at),
  ]);
  return { ...session, agent_session_id: null, status: "active", updated_at: session.created_at };
}

export async function activeChatSession(db: D1Database, actorId: string, now = new Date()): Promise<ChatSession | null> {
  const session = await db.prepare("SELECT * FROM admin_chat_sessions WHERE actor_id=? AND status='active' ORDER BY created_at DESC LIMIT 1")
    .bind(actorId).first<ChatSession>();
  if (!session) return null;
  if (Date.parse(session.expires_at) <= now.valueOf()) {
    await closeChatSession(db, session.id, "expired", now);
    return null;
  }
  return session;
}

/** Records the remote session id once OpenAI has accepted the first input. */
export async function attachChatSession(db: D1Database, id: string, agentSessionId: string, now = new Date()): Promise<void> {
  await db.prepare("UPDATE admin_chat_sessions SET agent_session_id=?,updated_at=? WHERE id=? AND status='active'")
    .bind(agentSessionId, now.toISOString(), id).run();
}

export async function closeChatSession(db: D1Database, id: string, status: "expired" | "closed", now = new Date()): Promise<void> {
  await db.prepare("UPDATE admin_chat_sessions SET status=?,updated_at=? WHERE id=? AND status='active'")
    .bind(status, now.toISOString(), id).run();
}
