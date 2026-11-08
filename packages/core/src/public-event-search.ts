import { hydrateEventLocations } from "./locations";
import type { AdministrativeArea, EventSummary } from "./types";

export const EVENT_PAGE_SIZE = 30;
const categories = ["LIVE", "EVENT", "RELEASE", "MEDIA", "OTHER"];
export interface PublicEventSearch {
  query: string;
  categories: string[];
  locations: string[];
  year: string;
  sort: "asc" | "desc";
  after: string;
}
type Cursor = [string, string, string];
function cursorValue(raw: string): Cursor | null {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.length === 3 && value.every(v => typeof v === "string")
      && /^\d{4}-\d{2}-\d{2}$/.test(value[0]) && /^(?:\d{2}:\d{2})?$/.test(value[1])
      && value[2].length > 0 && value[2].length <= 200 ? value as Cursor : null;
  } catch { return null; }
}
export function parsePublicEventSearch(params: URLSearchParams): PublicEventSearch {
  const unique = (key: string) => [...new Set(params.getAll(key))].sort();
  const year = params.get("year") ?? "";
  const after = (params.get("after") ?? "").slice(0, 500);
  return {
    query: (params.get("q") ?? "").trim().slice(0, 200),
    categories: unique("category").filter(value => categories.includes(value)),
    locations: unique("location").filter(value => /^(?:jp:[\w-]{1,100}|country:[A-Z]{2})$/.test(value)).slice(0, 100),
    year: /^(?:19|20)\d{2}$/.test(year) || year === "2100" ? year : "",
    sort: params.get("sort") === "asc" ? "asc" : "desc",
    after: cursorValue(after) ? after : "",
  };
}
// Map every Japanese locality to its prefecture; foreign venues use their country.
const locationCTE = `WITH RECURSIVE jp_locations(id, location_key) AS (
  SELECT id, 'jp:' || id FROM administrative_areas WHERE country_code = 'JP' AND level = 'subdivision'
  UNION ALL SELECT a.id, p.location_key FROM administrative_areas a JOIN jp_locations p ON a.parent_id = p.id
)`;
const locationKey = `CASE WHEN a.country_code = 'JP' THEN jp.location_key ELSE 'country:' || a.country_code END`;
const locationJoin = `JOIN venues v ON v.id = ev.venue_id
  JOIN administrative_areas a ON a.id = v.administrative_area_id
  LEFT JOIN jp_locations jp ON jp.id = a.id`;
function where(input: PublicEventSearch) {
  const clauses = ["e.published = 1", "e.archived_at IS NULL"];
  const bindings: unknown[] = [];
  if (input.year) {
    clauses.push("e.start_date >= ? AND e.start_date < ?");
    bindings.push(`${input.year}-01-01`, `${Number(input.year) + 1}-01-01`);
  }
  if (input.categories.length) {
    clauses.push(`e.category IN (${input.categories.map(() => "?").join(",")})`);
    bindings.push(...input.categories);
  }
  if (input.locations.length) {
    clauses.push(`EXISTS (SELECT 1 FROM event_venues ev ${locationJoin}
      WHERE ev.event_id = e.id AND ${locationKey} IN (${input.locations.map(() => "?").join(",")}))`);
    bindings.push(...input.locations);
  }
  for (const term of input.query.split(/\s+/).filter(Boolean)) {
    const pattern = `%${term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const fields = ["e.title", "e.category", "e.classification", "e.location_note", "e.remark"];
    clauses.push(`(${fields.map(field => `${field} LIKE ? ESCAPE '\\'`).join(" OR ")}
      OR EXISTS (SELECT 1 FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
        LEFT JOIN administrative_areas a ON a.id = v.administrative_area_id
        WHERE ev.event_id = e.id AND (${["v.canonical_name", "ev.display_name_snapshot", "a.name_local", "a.name_zh", "a.name_ja", "a.name_en"].map(field => `${field} LIKE ? ESCAPE '\\'`).join(" OR ")}))
      OR EXISTS (SELECT 1 FROM event_channels ec WHERE ec.event_id = e.id AND ec.name LIKE ? ESCAPE '\\'))`);
    bindings.push(...Array(12).fill(pattern));
  }
  return { clauses, bindings };
}
export async function countPublicEventSearch(db: D1Database, input: PublicEventSearch): Promise<number> {
  const { clauses, bindings } = where(input);
  const row = await db.prepare(`${locationCTE} SELECT COUNT(*) AS count FROM events e WHERE ${clauses.join(" AND ")}`)
    .bind(...bindings).first<{ count: number }>();
  return row?.count ?? 0;
}
export async function listPublicEventSearch(db: D1Database, input: PublicEventSearch) {
  const { clauses, bindings } = where(input);
  const cursor = cursorValue(input.after);
  const direction = input.sort === "asc" ? "ASC" : "DESC";
  if (cursor) {
    clauses.push(`(e.start_date, COALESCE(e.start_time, ''), e.id) ${input.sort === "asc" ? ">" : "<"} (?, ?, ?)`);
    bindings.push(...cursor);
  }
  // Only fields used by cards/search results; detail and write paths keep full records.
  type Row = Omit<EventSummary, "venues" | "channels" | "venue_label" | "area_label" | "location_label">;
  const result = await db.prepare(`${locationCTE} SELECT e.id, e.slug, e.title, e.start_date, e.end_date,
    e.start_time, e.end_time, e.timezone, e.category, e.classification, e.location_mode, e.location_note, e.status
    FROM events e WHERE ${clauses.join(" AND ")}
    ORDER BY e.start_date ${direction}, COALESCE(e.start_time, '') ${direction}, e.id ${direction} LIMIT ?`)
    .bind(...bindings, EVENT_PAGE_SIZE + 1).all<Row>();
  const hasMore = result.results.length > EVENT_PAGE_SIZE;
  const rows = result.results.slice(0, EVENT_PAGE_SIZE);
  const events = await hydrateEventLocations(db, rows.map(row => ({ ...row,
    venues: [], channels: [], venue_label: null, area_label: null, location_label: row.location_note })));
  const last = rows.at(-1);
  return { events, nextCursor: hasMore && last ? JSON.stringify([last.start_date, last.start_time ?? "", last.id]) : "" };
}
export interface PublicEventFilters {
  years: { year: string; count: number }[];
  categories: { category: string; count: number }[];
  locations: (Pick<AdministrativeArea, "name_local" | "name_zh" | "name_ja" | "name_en"> & { key: string; count: number })[];
}
export async function getPublicEventFilters(db: D1Database): Promise<PublicEventFilters> {
  const [years, counts, locations] = await Promise.all([
    db.prepare(`SELECT substr(start_date, 1, 4) AS year, COUNT(*) AS count FROM events
      WHERE published = 1 AND archived_at IS NULL GROUP BY substr(start_date, 1, 4) ORDER BY year DESC`)
      .all<PublicEventFilters["years"][number]>(),
    db.prepare(`SELECT category, COUNT(*) AS count FROM events WHERE published = 1 AND archived_at IS NULL GROUP BY category`)
      .all<PublicEventFilters["categories"][number]>(),
    db.prepare(`${locationCTE}, event_locations AS (
      SELECT DISTINCT e.id, ${locationKey} AS location_key FROM events e
      JOIN event_venues ev ON ev.event_id = e.id ${locationJoin} WHERE e.published = 1 AND e.archived_at IS NULL
    ) SELECT el.location_key AS key, COUNT(*) AS count, label.name_local, label.name_zh, label.name_ja, label.name_en
      FROM event_locations el JOIN administrative_areas label ON
        (el.location_key = 'jp:' || label.id OR (label.level = 'country' AND el.location_key = 'country:' || label.country_code))
      GROUP BY el.location_key ORDER BY el.location_key`).all<PublicEventFilters["locations"][number]>(),
  ]);
  return { years: years.results, categories: counts.results, locations: locations.results };
}
