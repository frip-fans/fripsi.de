import type { APIRoute } from "astro";
import { getEnv } from "../lib/env";

export const GET: APIRoute = ({ request }) => new Response(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/admin\nSitemap: ${new URL("/sitemap.xml", getEnv().SITE_URL || new URL(request.url).origin)}\n`, {
  headers: { "content-type": "text/plain; charset=utf-8" }
});
