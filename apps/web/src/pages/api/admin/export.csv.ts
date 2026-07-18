import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";

function cell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export const GET: APIRoute = async () => {
  const result = await getEnv().DB.prepare(`
    SELECT e.*, GROUP_CONCAT(s.url, char(10)) AS source_urls
    FROM events e LEFT JOIN event_sources s ON s.event_id = e.id
    GROUP BY e.id ORDER BY e.start_date ASC
  `).all<Record<string, unknown>>();
  const columns = ["id", "slug", "title", "start_date", "end_date", "start_time", "end_time", "timezone", "category", "classification", "venue", "region", "remark", "status", "published", "version", "archived_at", "source_urls"];
  const csv = [columns.map(cell).join(","), ...result.results.map((row) => columns.map((column) => cell(row[column])).join(","))].join("\r\n");
  return new Response(`\uFEFF${csv}`, { headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="frip-fan-events-${new Date().toISOString().slice(0, 10)}.csv"`,
    "cache-control": "no-store"
  }});
};
