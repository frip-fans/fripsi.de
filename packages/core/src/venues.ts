import type { VenueUpdate } from "./schema";
import type { VenueField, VenueRecord } from "./types";

export const VENUE_FIELDS: VenueField[] = ["canonical_name", "administrative_area_id", "address_text", "latitude", "longitude", "coordinate_precision", "coordinate_source"];
export type VenueValues = Record<VenueField, string | number | null>;

/** Stored venue values with an update laid over them; clearing the coordinates clears what describes them. */
export function applyVenueUpdate<T extends VenueValues>(stored: T, update: VenueUpdate): T {
  const next = { ...stored };
  for (const field of VENUE_FIELDS) if (update[field] !== undefined) (next as VenueValues)[field] = update[field] ?? null;
  if (next.latitude === null) { next.coordinate_precision = null; next.coordinate_source = null; }
  return next;
}

interface Condition { sql: string; bindings: unknown[] }

export interface VenueWrite {
  venueId: string;
  /** Name stored before the write; a different `next.canonical_name` is a rename. */
  storedName: string;
  next: VenueValues;
  coordinatesChanged: boolean;
  /** On a rename, also rewrite event links whose saved display name is the old venue name. */
  syncDisplayNames: boolean;
  now: string;
  /** Guards the venue row itself. */
  update: Condition;
  /** Holds only once the guarded write went through; guards the alias and display-name follow-ups. */
  follow: Condition;
}

/** The statements that store a venue edit; shared by direct admin saves and published proposals. */
export function venueWriteStatements(db: D1Database, write: VenueWrite): D1PreparedStatement[] {
  const { venueId, next, now } = write;
  const statements = [db.prepare(`UPDATE venues SET canonical_name = ?, administrative_area_id = ?, address_text = ?,
    latitude = ?, longitude = ?, coordinate_precision = ?, coordinate_source = ?,
    coordinates_verified_at = CASE WHEN ? THEN ? ELSE coordinates_verified_at END, updated_at = ?
    WHERE id = ? AND ${write.update.sql}`)
    .bind(next.canonical_name, next.administrative_area_id, next.address_text, next.latitude, next.longitude,
      next.coordinate_precision, next.coordinate_source, write.coordinatesChanged ? 1 : 0, next.latitude === null ? null : now, now,
      venueId, ...write.update.bindings)];
  if (next.canonical_name !== write.storedName) {
    // The old name stays an alias, so searches for it keep finding the venue.
    statements.push(db.prepare(`INSERT OR IGNORE INTO venue_aliases (venue_id, alias) SELECT ?, ? WHERE ${write.follow.sql}`)
      .bind(venueId, next.canonical_name, ...write.follow.bindings));
    if (write.syncDisplayNames) {
      statements.push(db.prepare(`UPDATE event_venues SET display_name_snapshot = ?
        WHERE venue_id = ? AND display_name_snapshot = ? AND ${write.follow.sql}`)
        .bind(next.canonical_name, venueId, write.storedName, ...write.follow.bindings));
    }
  }
  return statements;
}

/** On a rename: how many event links would follow it and how many keep their own display name. */
export async function renameDisplayNameCounts(db: D1Database, venueId: string, storedName: string, newName: string, sync: boolean): Promise<{ kept: number; synced: number }> {
  const names = await db.prepare(`SELECT
      COALESCE(SUM(display_name_snapshot = ?), 0) AS following,
      COALESCE(SUM(display_name_snapshot <> ? AND display_name_snapshot <> ?), 0) AS other
    FROM event_venues WHERE venue_id = ? AND display_name_snapshot IS NOT NULL`)
    .bind(storedName, storedName, newName, venueId).first<{ following: number; other: number }>();
  const following = names?.following ?? 0;
  return { kept: (names?.other ?? 0) + (sync ? 0 : following), synced: sync ? following : 0 };
}

export interface VenueListItem extends VenueRecord { event_count: number }

export interface VenueEventLink {
  event_id: string;
  title: string;
  start_date: string;
  display_name_snapshot: string | null;
}

export interface VenueDetail extends VenueRecord {
  aliases: string[];
  events: VenueEventLink[];
}

const venueSelect = `SELECT v.*, a.name_local AS area_name, a.country_code
  FROM venues v LEFT JOIN administrative_areas a ON a.id = v.administrative_area_id`;

/** Venues with how many events use them; `query` matches name, alias, address or area. */
export async function listVenueUsage(db: D1Database, query?: string | null, limit = 2000): Promise<VenueListItem[]> {
  const needle = query?.trim() ? `%${query.trim().replace(/[\\%_]/g, "\\$&")}%` : null;
  const result = await db.prepare(`SELECT v.*, a.name_local AS area_name, a.country_code,
      (SELECT COUNT(*) FROM event_venues ev WHERE ev.venue_id = v.id) AS event_count
    FROM venues v LEFT JOIN administrative_areas a ON a.id = v.administrative_area_id
    WHERE ? IS NULL OR v.canonical_name LIKE ? ESCAPE '\\' OR v.address_text LIKE ? ESCAPE '\\' OR a.name_local LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM venue_aliases va WHERE va.venue_id = v.id AND va.alias LIKE ? ESCAPE '\\')
    ORDER BY v.canonical_name COLLATE NOCASE, v.id LIMIT ?`)
    .bind(needle, needle, needle, needle, needle, Math.max(1, Math.min(limit, 5000))).all<VenueListItem>();
  return result.results;
}

export async function getVenueById(db: D1Database, id: string): Promise<VenueDetail | null> {
  const venue = await db.prepare(`${venueSelect} WHERE v.id = ?`).bind(id).first<VenueRecord>();
  if (!venue) return null;
  const [aliases, events] = await Promise.all([
    db.prepare("SELECT alias FROM venue_aliases WHERE venue_id = ? ORDER BY alias").bind(id).all<{ alias: string }>(),
    db.prepare(`SELECT e.id AS event_id, e.title, e.start_date, ev.display_name_snapshot
      FROM event_venues ev JOIN events e ON e.id = ev.event_id
      WHERE ev.venue_id = ? ORDER BY e.start_date DESC, e.id`).bind(id).all<VenueEventLink>(),
  ]);
  return { ...venue, aliases: aliases.results.map((row) => row.alias), events: events.results };
}
