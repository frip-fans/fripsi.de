import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";

function cell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export const GET: APIRoute = async () => {
  const result = await getEnv().DB.prepare(`
    SELECT e.*,
      (SELECT GROUP_CONCAT(ev.venue_id, char(10)) FROM event_venues ev WHERE ev.event_id = e.id) AS venue_ids,
      (SELECT GROUP_CONCAT(COALESCE(ev.display_name_snapshot, v.canonical_name), char(10))
        FROM event_venues ev JOIN venues v ON v.id = ev.venue_id WHERE ev.event_id = e.id) AS venue_names,
      (SELECT GROUP_CONCAT(a.name_local, char(10)) FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
        JOIN administrative_areas a ON a.id = v.administrative_area_id WHERE ev.event_id = e.id) AS area_names,
      (SELECT GROUP_CONCAT(ac.scheme || ':' || ac.code, char(10)) FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
        JOIN administrative_area_codes ac ON ac.administrative_area_id = v.administrative_area_id WHERE ev.event_id = e.id) AS area_codes,
      (SELECT GROUP_CONCAT(ec.channel_type || ':' || ec.name, char(10)) FROM event_channels ec WHERE ec.event_id = e.id) AS channels,
      GROUP_CONCAT(s.url, char(10)) AS source_urls
    FROM events e LEFT JOIN event_sources s ON s.event_id = e.id
    GROUP BY e.id ORDER BY e.start_date ASC
  `).all<Record<string, unknown>>();
  const columns = ["id", "slug", "title", "start_date", "end_date", "start_time", "end_time", "timezone", "category", "classification", "location_mode", "location_note", "venue_ids", "venue_names", "area_names", "area_codes", "channels", "remark", "status", "published", "version", "archived_at", "source_urls"];
  const csv = [columns.map(cell).join(","), ...result.results.map((row) => columns.map((column) => cell(row[column])).join(","))].join("\r\n");
  return new Response(`\uFEFF${csv}`, { headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="frip-fan-events-${new Date().toISOString().slice(0, 10)}.csv"`,
    "cache-control": "no-store"
  }});
};
