import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Actor } from "./types";
import { ServiceError } from "./utils";

export interface AuthEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  MCP_AUDIENCE?: string;
  ADMIN_PUBLISHERS?: string;
  DEV_AUTH_BYPASS?: string;
  DEV_ACTOR?: string;
}

const allScopes = ["events:read", "events:draft", "events:publish", "events:archive"];
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function normalizeTeamDomain(value?: string): string {
  if (!value) throw new ServiceError("auth_config", "缺少 ACCESS_TEAM_DOMAIN", 500);
  return value.startsWith("https://") ? value.replace(/\/$/, "") : `https://${value.replace(/\/$/, "")}`;
}

async function verifyToken(token: string, teamDomain: string, audience: string): Promise<JWTPayload> {
  const issuer = normalizeTeamDomain(teamDomain);
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksCache.set(issuer, jwks);
  }
  const result = await jwtVerify(token, jwks, { issuer, audience });
  return result.payload;
}

function devActor(env: AuthEnv, channel: "admin" | "mcp"): Actor | null {
  if (env.DEV_AUTH_BYPASS !== "true") return null;
  return {
    id: env.DEV_ACTOR || "local-developer@example.com",
    type: channel === "mcp" ? "ai" : "human",
    channel,
    scopes: allScopes
  };
}

export async function authenticateAdmin(request: Request, env: AuthEnv): Promise<Actor> {
  const local = devActor(env, "admin");
  if (local) return local;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new ServiceError("unauthorized", "需要 Cloudflare Access 登录", 401);
  if (!env.ACCESS_AUD) throw new ServiceError("auth_config", "缺少 ACCESS_AUD", 500);
  const payload = await verifyToken(token, env.ACCESS_TEAM_DOMAIN!, env.ACCESS_AUD);
  const email = String(payload.email || payload.sub || "unknown");
  const publishers = (env.ADMIN_PUBLISHERS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const scopes = ["events:read", "events:draft"];
  if (publishers.includes(email.toLowerCase())) scopes.push("events:publish", "events:archive");
  return { id: email, type: "human", channel: "admin", scopes };
}

export async function authenticateMcp(request: Request, env: AuthEnv): Promise<Actor> {
  const local = devActor(env, "mcp");
  if (local) return local;
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new ServiceError("unauthorized", "需要 Bearer token", 401);
  if (!env.MCP_AUDIENCE) throw new ServiceError("auth_config", "缺少 MCP_AUDIENCE", 500);
  const payload = await verifyToken(authorization.slice(7), env.ACCESS_TEAM_DOMAIN!, env.MCP_AUDIENCE);
  const scopeClaim = typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
  const scopesClaim = Array.isArray(payload.scopes) ? payload.scopes.map(String) : [];
  const scopes = [...new Set([...scopeClaim, ...scopesClaim])].filter((scope) => allScopes.includes(scope));
  if (!scopes.length) scopes.push("events:read");
  return {
    id: String(payload.email || payload.sub || "mcp-user"),
    type: "ai",
    channel: "mcp",
    scopes
  };
}
