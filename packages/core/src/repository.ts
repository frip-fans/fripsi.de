import { duplicateInputSchema, searchInputSchema, type SearchInput } from "./schema";
import type { AuditLog, ChangeSet, DuplicateCandidate, EventRecord, EventSource } from "./types";
import { normalizeForDuplicate, ServiceError } from "./utils";

interface EventRow extends Omit<EventRecord, "published" | "sources"> {
  published: number;
}

function mapEvent(row: EventRow): EventRecord {
  return { ...row, published: row.published === 1 };
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
  return event;
}

export async function getPublicEventBySlug(db: D1Database, slug: string): Promise<EventRecord | null> {
  const row = await db.prepare("SELECT * FROM events WHERE slug = ? AND published = 1 AND archived_at IS NULL").bind(slug).first<EventRow>();
  if (!row) return null;
  const event = mapEvent(row);
  event.sources = await getSources(db, event.id);
  return event;
}

export async function searchEvents(db: D1Database, raw: Partial<SearchInput> = {}, publicOnly = false): Promise<EventRecord[]> {
  const input = searchInputSchema.parse(raw);
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
    clauses.push("(title LIKE ? OR venue LIKE ? OR region LIKE ? OR classification LIKE ? OR EXISTS (SELECT 1 FROM event_sources s WHERE s.event_id = events.id AND s.url LIKE ?))");
    const pattern = `%${input.query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    bindings.push(pattern, pattern, pattern, pattern, pattern);
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

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const statement = db.prepare(`SELECT * FROM events ${where} ORDER BY start_date ASC, start_time ASC, title ASC LIMIT ?`);
  const result = await statement.bind(...bindings, input.limit).all<EventRow>();
  return result.results.map(mapEvent);
}

export async function listPublicCalendarEvents(db: D1Database): Promise<EventRecord[]> {
  const result = await db.prepare(`
    SELECT * FROM events
    WHERE published = 1 AND archived_at IS NULL
    ORDER BY start_date ASC, start_time ASC, title ASC
  `).all<EventRow>();
  return result.results.map(mapEvent);
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
      AND (e.title = ? OR (? IS NOT NULL AND e.venue = ?) OR (? IS NOT NULL AND s.url = ?))
    ORDER BY e.start_date ASC
    LIMIT 20
  `).bind(input.start_date, end, input.title, input.venue ?? null, input.venue ?? null, input.source_url ?? null, input.source_url ?? null).all<EventRow>();

  const normalizedTitle = normalizeForDuplicate(input.title);
  return result.results.map((row) => {
    const event = mapEvent(row);
    const reasons: string[] = [];
    if (normalizeForDuplicate(event.title) === normalizedTitle) reasons.push("标题相同或规范化后相同");
    if (input.venue && event.venue === input.venue) reasons.push("日期重叠且场地相同");
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
