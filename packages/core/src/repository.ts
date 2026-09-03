import { duplicateInputSchema, searchInputSchema, type SearchInput } from "./schema";
import { hydrateEventLocations } from "./locations";
import type { ArchiveFilterEntry, AuditLog, ChangeSet, DuplicateCandidate, EventRecord, EventSource } from "./types";
import { normalizeForDuplicate, ServiceError } from "./utils";

interface ArchiveFilterRow extends Omit<ArchiveFilterEntry, "venue_names" | "area_ids" | "area_names" | "channel_names"> {
  venue_names: string | null;
  area_ids: string | null;
  area_names: string | null;
  channel_names: string | null;
}

interface EventRow extends Omit<EventRecord, "published" | "sources" | "venues" | "channels" | "venue_label" | "area_label" | "location_label"> {
  published: number;
}

function eventSearchWhere(input: SearchInput, publicOnly: boolean): { where: string; bindings: unknown[] } {
  const clauses: string[] = [];
  const bindings: unknown[] = [];

  if (publicOnly) clauses.push("published = 1", "archived_at IS NULL");
  else {
    if (!input.include_archived) clauses.push("archived_at IS NULL");
    if (input.published !== undefined) {
      clauses.push("published = ?");
      bindings.push(input.published ? 1 : 0);
    }
  }
  if (input.query) {
    clauses.push(`(title LIKE ? OR classification LIKE ?
      OR EXISTS (SELECT 1 FROM event_sources s WHERE s.event_id = events.id AND s.url LIKE ?)
      OR EXISTS (SELECT 1 FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
        LEFT JOIN administrative_areas a ON a.id = v.administrative_area_id
        WHERE ev.event_id = events.id AND (v.canonical_name LIKE ? OR a.name_local LIKE ?))
      OR EXISTS (SELECT 1 FROM event_channels ec WHERE ec.event_id = events.id AND ec.name LIKE ?))`);
    const pattern = `%${input.query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    bindings.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (input.date_from) {
    clauses.push("COALESCE(end_date, start_date) >= ?");
    bindings.push(input.date_from);
  }
  if (input.date_to) {
    clauses.push("start_date <= ?");
    bindings.push(input.date_to);
  }
  if (input.categories?.length) {
    clauses.push(`category IN (${input.categories.map(() => "?").join(",")})`);
    bindings.push(...input.categories);
  }
  if (input.statuses?.length) {
    clauses.push(`status IN (${input.statuses.map(() => "?").join(",")})`);
    bindings.push(...input.statuses);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    bindings,
  };
}

function mapEvent(row: EventRow): EventRecord {
  return {
    ...row,
    published: row.published === 1,
    venues: [],
    channels: [],
    venue_label: null,
    area_label: null,
    location_label: row.location_note,
  };
}

export async function getSources(db: D1Database, eventId: string): Promise<EventSource[]> {
  const result = await db.prepare("SELECT * FROM event_sources WHERE event_id = ? ORDER BY created_at ASC").bind(eventId).all<EventSource>();
  return result.results;
}

export async function getEventById(db: D1Database, id: string, includeSources = true): Promise<EventRecord | null> {
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
  if (!row) return null;
  const event = mapEvent(row);
  if (includeSources) event.sources = await getSources(db, id);
  return (await hydrateEventLocations(db, [event]))[0];
}

export async function getPublicEventBySlug(db: D1Database, slug: string): Promise<EventRecord | null> {
  const row = await db.prepare("SELECT * FROM events WHERE slug = ? AND published = 1 AND archived_at IS NULL").bind(slug).first<EventRow>();
  if (!row) return null;
  const event = mapEvent(row);
  event.sources = await getSources(db, event.id);
  return (await hydrateEventLocations(db, [event]))[0];
}

export async function searchEvents(db: D1Database, raw: Partial<SearchInput> = {}, publicOnly = false): Promise<EventRecord[]> {
  const input = searchInputSchema.parse(raw);
  const { where, bindings } = eventSearchWhere(input, publicOnly);
  const statement = db.prepare(`SELECT * FROM events ${where} ORDER BY start_date ASC, start_time ASC, title ASC LIMIT ? OFFSET ?`);
  const result = await statement.bind(...bindings, input.limit, input.offset).all<EventRow>();
  return hydrateEventLocations(db, result.results.map(mapEvent));
}

export async function countEvents(db: D1Database, raw: Partial<SearchInput> = {}, publicOnly = false): Promise<number> {
  const input = searchInputSchema.parse(raw);
  const { where, bindings } = eventSearchWhere(input, publicOnly);
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM events ${where}`).bind(...bindings).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function listPublicCalendarEvents(db: D1Database): Promise<EventRecord[]> {
  const result = await db.prepare(`
    SELECT * FROM events
    WHERE published = 1 AND archived_at IS NULL
    ORDER BY start_date ASC, start_time ASC, title ASC
  `).all<EventRow>();
  return hydrateEventLocations(db, result.results.map(mapEvent));
}

export async function listLatestPublicEvents(db: D1Database, limit = 6): Promise<EventRecord[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const result = await db.prepare(`
    SELECT * FROM events
    WHERE published = 1 AND archived_at IS NULL
    ORDER BY start_date DESC, start_time DESC, title ASC
    LIMIT ?
  `).bind(safeLimit).all<EventRow>();
  return hydrateEventLocations(db, result.results.map(mapEvent));
}

export async function listArchiveFilterEntries(db: D1Database): Promise<ArchiveFilterEntry[]> {
  const result = await db.prepare(`SELECT
    e.id, e.title, e.start_date, e.category, e.classification, e.location_note, e.remark,
    (SELECT GROUP_CONCAT(v.canonical_name, char(31))
      FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
      WHERE ev.event_id = e.id ORDER BY ev.position, ev.venue_id) AS venue_names,
    (SELECT GROUP_CONCAT(v.administrative_area_id, char(31))
      FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
      WHERE ev.event_id = e.id AND v.administrative_area_id IS NOT NULL
      ORDER BY ev.position, ev.venue_id) AS area_ids,
    (SELECT GROUP_CONCAT(a.name_local, char(31))
      FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
      JOIN administrative_areas a ON a.id = v.administrative_area_id
      WHERE ev.event_id = e.id ORDER BY ev.position, ev.venue_id) AS area_names,
    (SELECT GROUP_CONCAT(ec.name, char(31)) FROM event_channels ec
      WHERE ec.event_id = e.id ORDER BY ec.position, ec.id) AS channel_names
    FROM events e
    WHERE e.published = 1 AND e.archived_at IS NULL
    ORDER BY e.start_date ASC, e.title ASC`).all<ArchiveFilterRow>();
  const split = (value: string | null): string[] => value?.split("\u001f").filter(Boolean) ?? [];
  return result.results.map((entry) => ({
    ...entry,
    venue_names: split(entry.venue_names),
    area_ids: split(entry.area_ids),
    area_names: split(entry.area_names),
    channel_names: split(entry.channel_names),
  }));
}

export async function listArchiveYears(db: D1Database): Promise<Array<{ year: string; count: number }>> {
  const result = await db.prepare(`
    SELECT substr(start_date, 1, 4) AS year, COUNT(*) AS count
    FROM events
    WHERE published = 1 AND archived_at IS NULL
    GROUP BY substr(start_date, 1, 4)
    ORDER BY year DESC
  `).all<{ year: string; count: number }>();
  return result.results;
}

export async function findDuplicates(db: D1Database, raw: unknown): Promise<DuplicateCandidate[]> {
  const input = duplicateInputSchema.parse(raw);
  const end = input.end_date ?? input.start_date;
  const result = await db.prepare(`
    SELECT DISTINCT e.* FROM events e
    LEFT JOIN event_sources s ON s.event_id = e.id
    WHERE e.archived_at IS NULL
      AND COALESCE(e.end_date, e.start_date) >= ?
      AND e.start_date <= ?
      AND (e.title = ? OR (? IS NOT NULL AND EXISTS (
        SELECT 1 FROM event_venues ev WHERE ev.event_id = e.id AND ev.venue_id = ?
      )) OR (? IS NOT NULL AND s.url = ?))
    ORDER BY e.start_date ASC
    LIMIT 20
  `).bind(input.start_date, end, input.title, input.venue_id ?? null, input.venue_id ?? null, input.source_url ?? null, input.source_url ?? null).all<EventRow>();

  const normalizedTitle = normalizeForDuplicate(input.title);
  const events = await hydrateEventLocations(db, result.results.map(mapEvent));
  return events.map((event) => {
    const reasons: string[] = [];
    if (normalizeForDuplicate(event.title) === normalizedTitle) reasons.push("标题相同或规范化后相同");
    if (input.venue_id && event.venues.some((venue) => venue.id === input.venue_id)) reasons.push("日期重叠且场地相同");
    if (input.source_url) reasons.push("可能使用了相同来源 URL");
    return { event, reasons };
  });
}

export async function getChangeSet(db: D1Database, id: string): Promise<ChangeSet | null> {
  return db.prepare("SELECT * FROM change_sets WHERE id = ?").bind(id).first<ChangeSet>();
}

export async function getChangeSetByKey(db: D1Database, key: string): Promise<ChangeSet | null> {
  return db.prepare("SELECT * FROM change_sets WHERE idempotency_key = ?").bind(key).first<ChangeSet>();
}

export async function listChangeSets(db: D1Database, status?: string, limit = 100): Promise<ChangeSet[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const statement = status
    ? db.prepare("SELECT * FROM change_sets WHERE status = ? ORDER BY created_at DESC LIMIT ?").bind(status, safeLimit)
    : db.prepare("SELECT * FROM change_sets ORDER BY created_at DESC LIMIT ?").bind(safeLimit);
  const result = await statement.all<ChangeSet>();
  return result.results;
}

export async function listAuditLogs(db: D1Database, limit = 100): Promise<AuditLog[]> {
  const result = await db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?").bind(Math.max(1, Math.min(limit, 200))).all<AuditLog>();
  return result.results;
}

export async function requireEvent(db: D1Database, id: string): Promise<EventRecord> {
  const event = await getEventById(db, id);
  if (!event) throw new ServiceError("not_found", "没有找到活动", 404);
  return event;
}
