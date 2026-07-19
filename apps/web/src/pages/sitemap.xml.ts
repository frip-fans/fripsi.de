import type { APIRoute } from "astro";
import { getEnv } from "../lib/env";

export const GET: APIRoute = async ({ request }) => {
  const db = getEnv().DB;
  const [events, songs, releases, setlists] = await Promise.all([
    db.prepare("SELECT slug, updated_at FROM events WHERE published = 1 AND archived_at IS NULL ORDER BY start_date DESC").all<{ slug: string; updated_at: string }>(),
    db.prepare("SELECT slug, updated_at FROM songs WHERE published = 1 ORDER BY updated_at DESC").all<{ slug: string; updated_at: string }>(),
    db.prepare("SELECT slug, updated_at FROM releases WHERE published = 1 ORDER BY updated_at DESC").all<{ slug: string; updated_at: string }>(),
    db.prepare("SELECT id, updated_at FROM setlists WHERE published = 1 ORDER BY updated_at DESC").all<{ id: string; updated_at: string }>(),
  ]);
  const site = getEnv().SITE_URL || new URL(request.url).origin;
  const staticPaths = ["/", "/calendar", "/archive", "/music/lives", "/music/releases", "/music/songs", "/about"];
  const urls = [
    ...staticPaths.map((path) => `<url><loc>${new URL(path, site)}</loc></url>`),
    ...events.results.map((row) => `<url><loc>${new URL(`/events/${encodeURIComponent(row.slug)}`, site)}</loc><lastmod>${row.updated_at.slice(0, 10)}</lastmod></url>`),
    ...songs.results.map((row) => `<url><loc>${new URL(`/music/songs/${encodeURIComponent(row.slug)}`, site)}</loc><lastmod>${row.updated_at.slice(0, 10)}</lastmod></url>`),
    ...releases.results.map((row) => `<url><loc>${new URL(`/music/releases/${encodeURIComponent(row.slug)}`, site)}</loc><lastmod>${row.updated_at.slice(0, 10)}</lastmod></url>`),
    ...setlists.results.map((row) => `<url><loc>${new URL(`/music/lives/${encodeURIComponent(row.id)}`, site)}</loc><lastmod>${row.updated_at.slice(0, 10)}</lastmod></url>`),
  ].join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" }
  });
};
