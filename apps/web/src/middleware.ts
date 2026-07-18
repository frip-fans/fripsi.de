import { authenticateAdmin, ServiceError } from "@frip-fan/core";
import { defineMiddleware } from "astro:middleware";
import { getEnv } from "./lib/env";

function secure(response: Response, privateRoute = false): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("content-security-policy", "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'");
  if (privateRoute) headers.set("cache-control", "private, no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  const privateRoute = path.startsWith("/admin") || path.startsWith("/api/admin");
  if (!privateRoute) return secure(await next());

  try {
    context.locals.actor = await authenticateAdmin(context.request, getEnv());
    return secure(await next(), true);
  } catch (error) {
    const status = error instanceof ServiceError ? error.status : 401;
    const message = error instanceof Error ? error.message : "未授权";
    if (path.startsWith("/api/")) {
      return secure(Response.json({ error: { code: "unauthorized", message } }, { status }), true);
    }
    return secure(new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>需要登录</title><body style="font-family:system-ui;padding:3rem;background:#07101c;color:#eef"><h1>需要登录</h1><p>${message}</p><p>生产环境中请先通过 Cloudflare Access；本地开发请复制 <code>.dev.vars.example</code> 为 <code>.dev.vars</code>。</p></body></html>`, {
      status,
      headers: { "content-type": "text/html; charset=utf-8" }
    }), true);
  }
});
