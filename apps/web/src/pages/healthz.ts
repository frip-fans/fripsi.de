import type { APIRoute } from "astro";
import { getEnv } from "../lib/env";
export const GET: APIRoute = async () => {
  const env = getEnv();
  if (env.FRIP_RUNTIME !== "node") return new Response("Not found", { status: 404 });
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('events','songs','setlists')").first<{count:number}>();
    if (row?.count !== 3) throw new Error("Schema not ready");
    return Response.json({ ok: true, version: env.FRIP_RELEASE_SHA ?? "development" }, { headers: {"cache-control":"no-store"} });
  } catch { return Response.json({ok:false},{status:503,headers:{"cache-control":"no-store"}}); }
};
