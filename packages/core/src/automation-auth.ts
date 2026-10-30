import { SignJWT, jwtVerify } from "jose";
import type { Actor } from "./types";
import { ServiceError } from "./utils";

const issuer = "fripsi:official-sync";
export const automationSubject = "official-sync-agent";

export async function signAutomationToken(secret: string, audience: string, runId: string, createdAt: string, role: "primary" | "review" = "primary"): Promise<string> {
  if (new TextEncoder().encode(secret).length < 32) throw new ServiceError("automation_config", "自动同步签名密钥至少需要 32 字节", 500);
  const issuedAt = Math.floor(Date.parse(createdAt) / 1000);
  return `fsync.${await new SignJWT({ run_id: runId, role }).setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer).setAudience(audience).setSubject(automationSubject)
    .setIssuedAt(issuedAt).setExpirationTime(issuedAt + 3600)
    .sign(new TextEncoder().encode(secret))}`;
}

export async function authenticateAutomationToken(token: string, env: {
  DB?: D1Database; AUTOMATION_SIGNING_SECRET?: string; AUTOMATION_AUDIENCE?: string;
}): Promise<Actor> {
  if (!env.DB || !env.AUTOMATION_AUDIENCE || !env.AUTOMATION_SIGNING_SECRET || new TextEncoder().encode(env.AUTOMATION_SIGNING_SECRET).length < 32) {
    throw new ServiceError("automation_config", "自动同步身份未配置", 503);
  }
  try {
    const { payload } = await jwtVerify(token.slice("fsync.".length), new TextEncoder().encode(env.AUTOMATION_SIGNING_SECRET), {
      algorithms: ["HS256"], issuer, audience: env.AUTOMATION_AUDIENCE, subject: automationSubject, maxTokenAge: "1h",
      requiredClaims: ["exp", "iat", "sub", "run_id"],
    });
    if (typeof payload.run_id !== "string") throw new Error("invalid_run");
    const run = await env.DB.prepare("SELECT status, auto_publish, created_at FROM official_sync_runs WHERE id = ?")
      .bind(payload.run_id).first<{ status: string; auto_publish: number; created_at: string }>();
    if (!run || !["starting", "running"].includes(run.status) || Date.now() - Date.parse(run.created_at) >= 3_600_000) throw new Error("inactive_run");
    return {
      id: automationSubject, type: "ai", channel: "mcp", automation_run_id: payload.run_id,
      automation_role: payload.role === "review" ? "review" : "primary",
      scopes: ["events:read", "events:draft", ...(run.auto_publish === 1 ? ["events:publish", "events:auto_publish"] : [])],
    };
  } catch { throw new ServiceError("unauthorized", "自动同步凭据无效、已过期或任务已结束", 401); }
}
