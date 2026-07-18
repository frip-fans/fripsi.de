import { generateICalendar, listPublicCalendarEvents } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { getEnv } from "../lib/env";

const cacheControl = "public, max-age=300, s-maxage=900, stale-while-revalidate=86400";

export const GET: APIRoute = async ({ request }) => {
  const env = getEnv();
  const events = await listPublicCalendarEvents(env.DB);
  const siteUrl = env.SITE_URL || new URL(request.url).origin;
  const versionTotal = events.reduce((total, event) => total + event.version, 0);
  const latestUpdate = events.reduce((latest, event) => event.updated_at > latest ? event.updated_at : latest, "");
  const etag = `W/\"calendar-${events.length}-${versionTotal}-${latestUpdate.replace(/\D/g, "")}\"`;
  const headers = {
    "content-type": "text/calendar; charset=utf-8",
    "content-disposition": "inline; filename=\"fripside-fan-site.ics\"",
    "cache-control": cacheControl,
    "access-control-allow-origin": "*",
    etag
  };

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(generateICalendar(events, { siteUrl }), { headers });
};
