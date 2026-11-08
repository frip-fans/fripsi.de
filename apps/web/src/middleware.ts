import { authenticateAdmin, ServiceError } from "@frip-fan/core";
import { defineMiddleware } from "astro:middleware";
import { getEnv } from "./lib/env";
import { publicResponse } from "#public-cache";
import { OFFICIAL_SITE_NOTICE_COOKIE } from "./lib/site-notice";
import { getLocale, type Locale } from "./lib/i18n";

function secure(response: Response, privateRoute = false, cacheControl?: string, locale?: Locale, allowGiscus = false, allowVectorMap = false, allowCoverPreview = false): Response {
  const headers = new Headers(response.headers);
  if (getEnv().APP_ENV === "staging") headers.set("x-robots-tag", "noindex, nofollow");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  const coverOrigin = allowCoverPreview ? " https://fripside.net" : "";
  const giscusOrigin = allowGiscus ? " https://giscus.app" : "";
  const vectorMapOrigin = allowVectorMap ? " https://tiles.openfreemap.org" : "";
  const vectorMapBlob = allowVectorMap ? " blob:" : "";
  const youtubeOrigin = allowVectorMap ? " https://www.youtube.com https://www.youtube-nocookie.com" : "";
  headers.set("content-security-policy", `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https://tile.openstreetmap.org${coverOrigin}${vectorMapOrigin}; style-src 'self' 'unsafe-inline'${giscusOrigin}; script-src 'self'${giscusOrigin}${youtubeOrigin}; connect-src 'self'${vectorMapOrigin}; worker-src 'self'${vectorMapBlob}; child-src 'self'${vectorMapBlob}; frame-src 'self'${giscusOrigin}${youtubeOrigin}`);
  if (locale && headers.get("content-type")?.includes("text/html")) {
    headers.set("content-language", locale);
    headers.append("vary", "Cookie");
  }
  if (privateRoute) headers.set("cache-control", "private, no-store");
  else if (cacheControl) headers.set("cache-control", cacheControl);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  const env = getEnv();
  const staging = env.APP_ENV === "staging";
  // MCP retains its own bearer/automation authorization, separate from the web admin session.
  if (env.FRIP_RUNTIME === "node" && ["/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/healthz"].includes(path)) {
    return secure(await next(), true);
  }
  const privateRoute = staging || path.startsWith("/admin") || path.startsWith("/api/admin");
  if (!privateRoute) {
    const cacheControl = path === "/archive" || (path === "/calendar" && context.url.searchParams.get("view") === "list") ? "private, max-age=60, stale-while-revalidate=30" : undefined;
    const locale = getLocale(context.request);
    const render = async () => secure(await next(), false, cacheControl, locale, path === "/" || path === "/discuss", path === "/journey");
    const eligible = env.FRIP_RUNTIME === "node" && context.request.method === "GET"
      && !context.request.headers.has("authorization") && context.url.href.length <= 2048
      && !path.startsWith("/api/admin") && !path.startsWith("/media/");
    const notice = eligible && context.cookies.get(OFFICIAL_SITE_NOTICE_COOKIE)?.value === "yes";
    return eligible ? publicResponse(`${context.url.href}|${locale}|${notice}`, render) : render();
  }

  try {
    // Staging protects every SSR route and cannot opt into the local identity bypass.
    context.locals.actor = await authenticateAdmin(context.request, staging ? { ...env, DEV_AUTH_BYPASS: "false" } : env);
    if (staging) {
      const publishers = (env.ADMIN_PUBLISHERS ?? "").split(",").map((email) => email.trim().toLowerCase());
      if (!publishers.includes(context.locals.actor.id.toLowerCase())) {
        throw new ServiceError("forbidden", "没有测试环境访问权限", 403);
      }
    }
    return secure(await next(), true, undefined, getLocale(context.request), !staging && (path === "/" || path === "/discuss"), path === "/journey", path.startsWith("/admin/music/releases"));
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
