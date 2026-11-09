import { buildSearchText, eventLabelSearchTerms, searchMatcher } from "./search-text";

/**
 * Text search over the catalogue. SQL LIKE cannot fold scripts (横滨 ≠ 横浜, カナ ≠ かな), so each
 * search loads the searchable text of every candidate, folds it in JS and returns the matching ids.
 * Callers keep their own filters, ordering and pagination in SQL and only add `id IN (matched ids)`.
 * The catalogue is small (hundreds of rows), so this costs a few milliseconds per query.
 */

export type SearchScope = "public" | "all";
type Row = Record<string, string | number | null>;
type Fields = Array<string | null | undefined>;

/** SQL fragment: `column IN` the JSON array bound to the next parameter. */
export function idInJson(column: string): string {
  return `${column} IN (SELECT value FROM json_each(?))`;
}

function pushTo(map: Map<string, Fields>, key: string, ...values: Fields) {
  let list = map.get(key);
  if (!list) map.set(key, list = []);
  list.push(...values);
}

function splitList(value: string | number | null | undefined): string[] {
  return typeof value === "string" && value ? value.split("\u0001") : [];
}

function matchIds(rows: Array<{ id: string; fields: Fields }>, query: string): string[] {
  const matches = searchMatcher(query);
  return rows.filter(row => matches(buildSearchText(row.fields))).map(row => row.id);
}

/** Venue names, venue aliases and every enclosing area's local/zh/ja/en names, per event. */
async function eventPlaceFields(db: D1Database): Promise<Map<string, Fields>> {
  const [places, aliases] = await Promise.all([
    db.prepare(`WITH RECURSIVE venue_areas(venue_id, area_id) AS (
        SELECT id, administrative_area_id FROM venues WHERE administrative_area_id IS NOT NULL
        UNION SELECT va.venue_id, a.parent_id FROM venue_areas va JOIN administrative_areas a ON a.id = va.area_id WHERE a.parent_id IS NOT NULL
      )
      SELECT ev.event_id, ev.display_name_snapshot, v.canonical_name,
        (SELECT GROUP_CONCAT(COALESCE(a.name_local, '') || char(1) || COALESCE(a.name_zh, '') || char(1) || COALESCE(a.name_ja, '') || char(1) || COALESCE(a.name_en, ''), char(1))
          FROM venue_areas va JOIN administrative_areas a ON a.id = va.area_id WHERE va.venue_id = v.id) AS area_names
      FROM event_venues ev LEFT JOIN venues v ON v.id = ev.venue_id`).all<Row>(),
    db.prepare(`SELECT ev.event_id, va.alias FROM event_venues ev JOIN venue_aliases va ON va.venue_id = ev.venue_id`).all<Row>(),
  ]);
  const byEvent = new Map<string, Fields>();
  for (const row of places.results) {
    pushTo(byEvent, String(row.event_id), row.display_name_snapshot as string | null, row.canonical_name as string | null, ...splitList(row.area_names));
  }
  for (const row of aliases.results) pushTo(byEvent, String(row.event_id), row.alias as string);
  return byEvent;
}

/** Title, display name, tour, category/classification labels, notes, places and channels. Admin search also matches source URLs. */
async function eventCorpus(db: D1Database, scope: SearchScope, withSources = scope === "all"): Promise<Map<string, Fields>> {
  const [events, places, channels, sources] = await Promise.all([
    db.prepare(`SELECT e.id, e.title, e.alias, e.tour_stop, e.category, e.classification, e.location_note, e.remark, t.name AS tour_name
      FROM events e LEFT JOIN tours t ON t.id = e.tour_id ${scope === "public" ? "AND t.published = 1" : ""}
      ${scope === "public" ? "WHERE e.published = 1 AND e.archived_at IS NULL" : ""}`).all<Row>(),
    eventPlaceFields(db),
    db.prepare("SELECT event_id, name FROM event_channels").all<Row>(),
    withSources ? db.prepare("SELECT event_id, url FROM event_sources").all<Row>() : Promise.resolve({ results: [] as Row[] }),
  ]);
  const extra = new Map<string, Fields>();
  for (const row of channels.results) pushTo(extra, String(row.event_id), row.name as string);
  for (const row of sources.results) pushTo(extra, String(row.event_id), row.url as string);
  const corpus = new Map<string, Fields>();
  for (const event of events.results) {
    const id = String(event.id);
    const category = event.category as string | null;
    const classification = event.classification as string | null;
    corpus.set(id, [
      event.title as string, event.alias as string | null, event.tour_name as string | null, event.tour_stop as string | null,
      category, classification, ...eventLabelSearchTerms(category, classification),
      event.location_note as string | null, event.remark as string | null,
      ...(places.get(id) ?? []), ...(extra.get(id) ?? []),
    ]);
  }
  return corpus;
}

export async function matchEventIds(db: D1Database, query: string, scope: SearchScope): Promise<string[]> {
  const corpus = await eventCorpus(db, scope);
  return matchIds([...corpus].map(([id, fields]) => ({ id, fields })), query);
}

/** Setlists match their event's text plus their own title and every performed song (title, display title, aliases). */
export async function matchSetlistIds(db: D1Database, query: string, scope: SearchScope): Promise<string[]> {
  const [setlists, entries, events] = await Promise.all([
    db.prepare(`SELECT sl.id, sl.event_id, sl.title, sl.performance_label FROM setlists sl JOIN events e ON e.id = sl.event_id
      ${scope === "public" ? "WHERE sl.published = 1 AND e.published = 1 AND e.archived_at IS NULL" : ""}`).all<Row>(),
    db.prepare(`SELECT se.setlist_id, se.display_title, s.title,
        (SELECT GROUP_CONCAT(sa.alias, char(1)) FROM song_aliases sa WHERE sa.song_id = s.id) AS aliases
      FROM setlist_entries se LEFT JOIN songs s ON s.id = se.song_id`).all<Row>(),
    eventCorpus(db, scope, false),
  ]);
  const songs = new Map<string, Fields>();
  for (const row of entries.results) pushTo(songs, String(row.setlist_id), row.display_title as string | null, row.title as string | null, ...splitList(row.aliases));
  return matchIds(setlists.results.map(row => ({
    id: String(row.id),
    fields: [row.title as string | null, row.performance_label as string | null, ...(events.get(String(row.event_id)) ?? []), ...(songs.get(String(row.id)) ?? [])],
  })), query);
}

/** Songs match title, original artist, aliases and version titles; admin search also matches slugs. */
export async function matchSongIds(db: D1Database, query: string, scope: SearchScope): Promise<string[]> {
  const result = await db.prepare(`SELECT s.id, s.slug, s.title, s.original_artist,
      (SELECT GROUP_CONCAT(sa.alias, char(1)) FROM song_aliases sa WHERE sa.song_id = s.id) AS aliases,
      (SELECT GROUP_CONCAT(sv.title, char(1)) FROM song_versions sv WHERE sv.song_id = s.id ${scope === "public" ? "AND sv.published = 1" : ""}) AS versions
    FROM songs s ${scope === "public" ? "WHERE s.published = 1" : ""}`).all<Row>();
  return matchIds(result.results.map(row => ({
    id: String(row.id),
    fields: [row.title as string, row.original_artist as string | null, ...splitList(row.aliases), ...splitList(row.versions), scope === "all" ? row.slug as string : null],
  })), query);
}

/** Releases match title, catalogue number, edition and aliases; admin search also matches slugs. */
export async function matchReleaseIds(db: D1Database, query: string, scope: SearchScope): Promise<string[]> {
  const result = await db.prepare(`SELECT r.id, r.slug, r.title, r.catalog_number, r.edition,
      (SELECT GROUP_CONCAT(ra.alias, char(1)) FROM release_aliases ra WHERE ra.release_id = r.id) AS aliases
    FROM releases r ${scope === "public" ? "WHERE r.published = 1" : ""}`).all<Row>();
  return matchIds(result.results.map(row => ({
    id: String(row.id),
    fields: [row.title as string, row.catalog_number as string | null, row.edition as string | null, ...splitList(row.aliases), scope === "all" ? row.slug as string : null],
  })), query);
}
