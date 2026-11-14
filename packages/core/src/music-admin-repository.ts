import { eventTourStopSql } from "./event-display";
import { idInJson, matchReleaseIds, matchSetlistIds, matchSongIds } from "./search-index";
import type {
  AdminReleaseDetail,
  AdminReleaseSummary,
  AdminSongDetail,
  AdminSongSummary,
  AdminSongVersion,
  AdminSetlistDetail,
  AdminSetlistSummary,
  CatalogSource,
  MusicEditorOptions,
  ReleaseTrackRecord,
  SetlistEntryRecord,
} from "./music-types";

interface AdminReleaseRow extends Omit<AdminReleaseSummary, "published"> {
  published: number;
}

interface AdminSetlistRow extends Omit<AdminSetlistSummary, "published"> {
  published: number;
}

interface AdminSongRow extends Omit<AdminSongSummary, "published"> {
  published: number;
}

interface AdminSongVersionRow extends Omit<AdminSongVersion, "published" | "sources"> {
  published: number;
}


const adminEventVenueDisplay = `(SELECT GROUP_CONCAT(COALESCE(ev.display_name_snapshot, v.canonical_name), ' / ')
  FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
  WHERE ev.event_id = e.id ORDER BY ev.position)`;
const adminEventAreaDisplay = `(SELECT GROUP_CONCAT(area_name, ' / ') FROM (
  SELECT DISTINCT a.name_local AS area_name
  FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
  JOIN administrative_areas a ON a.id = v.administrative_area_id
  WHERE ev.event_id = e.id ORDER BY ev.position
))`;

function mapRelease(row: AdminReleaseRow): AdminReleaseSummary {
  return { ...row, published: row.published === 1 };
}

function mapSetlist(row: AdminSetlistRow): AdminSetlistSummary {
  return { ...row, published: row.published === 1 };
}

function mapSong(row: AdminSongRow): AdminSongSummary {
  return { ...row, published: row.published === 1 };
}

async function listSources(db: D1Database, subjectType: CatalogSource["subject_type"], subjectId: string): Promise<CatalogSource[]> {
  const result = await db.prepare(`
    SELECT * FROM catalog_sources
    WHERE subject_type = ? AND subject_id = ?
    ORDER BY created_at ASC
  `).bind(subjectType, subjectId).all<CatalogSource>();
  return result.results;
}

const adminSongSelect = `
  SELECT s.id, s.slug, s.title, s.original_artist, s.first_release_date, s.notes, s.phase_mask, s.published,
    s.created_at, s.updated_at,
    (SELECT COUNT(*) FROM song_versions sv WHERE sv.song_id = s.id) AS version_count,
    (SELECT COUNT(DISTINCT rt.release_id)
      FROM song_versions sv JOIN release_tracks rt ON rt.song_version_id = sv.id
      WHERE sv.song_id = s.id) AS release_count,
    (SELECT COUNT(DISTINCT se.setlist_id) FROM setlist_entries se WHERE se.song_id = s.id) AS show_count,
    (SELECT COUNT(*) FROM setlist_entries se WHERE se.song_id = s.id) AS performance_count
  FROM songs s
`;

const pageLimit = (limit: number) => Math.max(1, Math.min(limit, 500));
const pageOffset = (offset: number) => Math.max(0, Math.trunc(offset));

async function countRows(db: D1Database, sql: string, bindings: string[]): Promise<number> {
  const row = await db.prepare(sql).bind(...bindings).first<{ total: number }>();
  return row?.total ?? 0;
}

async function adminSongWhere(db: D1Database, query?: string): Promise<{ where: string; bindings: string[] }> {
  const search = query?.trim();
  return search
    ? { where: `WHERE ${idInJson("s.id")}`, bindings: [JSON.stringify(await matchSongIds(db, search, "all"))] }
    : { where: "", bindings: [] };
}

export async function listAdminSongs(db: D1Database, query?: string, limit = 500, offset = 0): Promise<AdminSongSummary[]> {
  const { where, bindings } = await adminSongWhere(db, query);
  // The id keeps rows that tie on the sort keys in one place across pages.
  const result = await db.prepare(`${adminSongSelect}
    ${where}
    ORDER BY s.updated_at DESC, s.title COLLATE NOCASE ASC, s.id ASC
    LIMIT ? OFFSET ?
  `).bind(...bindings, pageLimit(limit), pageOffset(offset)).all<AdminSongRow>();
  return result.results.map(mapSong);
}

export async function countAdminSongs(db: D1Database, query?: string): Promise<number> {
  const { where, bindings } = await adminSongWhere(db, query);
  return countRows(db, `SELECT COUNT(*) AS total FROM songs s ${where}`, bindings);
}

export async function getAdminSongById(db: D1Database, id: string): Promise<AdminSongDetail | null> {
  const row = await db.prepare(`${adminSongSelect} WHERE s.id = ?`).bind(id).first<AdminSongRow>();
  if (!row) return null;
  const song = mapSong(row);
  const [aliasesResult, versionsResult, sources] = await Promise.all([
    db.prepare("SELECT alias FROM song_aliases WHERE song_id = ? ORDER BY alias COLLATE NOCASE ASC")
      .bind(id).all<{ alias: string }>(),
    db.prepare(`
      SELECT id, song_id, slug, title, version_label, artist_credit, release_date, notes,
        published, created_at, updated_at
      FROM song_versions
      WHERE song_id = ?
      ORDER BY release_date IS NULL ASC, release_date ASC, title COLLATE NOCASE ASC
    `).bind(id).all<AdminSongVersionRow>(),
    listSources(db, "song", id),
  ]);
  const versions = await Promise.all(versionsResult.results.map(async (version): Promise<AdminSongVersion> => ({
    ...version,
    published: version.published === 1,
    sources: await listSources(db, "version", version.id),
  })));
  return {
    ...song,
    aliases: aliasesResult.results.map((alias) => alias.alias),
    versions,
    sources,
  };
}

const adminReleaseSelect = `
  SELECT r.*,
    (SELECT COUNT(*) FROM release_tracks rt WHERE rt.release_id = r.id) AS track_count,
    (SELECT COUNT(DISTINCT sv.song_id)
      FROM release_tracks rt
      JOIN song_versions sv ON sv.id = rt.song_version_id
      WHERE rt.release_id = r.id
        AND EXISTS (
          SELECT 1 FROM setlist_entries se
          JOIN setlists sl ON sl.id = se.setlist_id AND sl.published = 1
          JOIN events e ON e.id = sl.event_id AND e.published = 1 AND e.archived_at IS NULL
          WHERE se.song_id = sv.song_id
        )) AS performed_song_count
  FROM releases r
`;

const adminSetlistSelect = `
  SELECT sl.*, e.slug AS event_slug, e.alias AS event_alias, ${eventTourStopSql("e")} AS event_tour_title, e.title AS event_title, e.category AS event_category,
    e.classification AS event_classification, e.start_date, e.start_time,
    ${adminEventVenueDisplay} AS venue, ${adminEventAreaDisplay} AS region,
    (SELECT COUNT(*) FROM setlist_entries se WHERE se.setlist_id = sl.id) AS entry_count
  FROM setlists sl
  JOIN events e ON e.id = sl.event_id
`;

async function adminReleaseWhere(db: D1Database, query?: string): Promise<{ where: string; bindings: string[] }> {
  const search = query?.trim();
  return search
    ? { where: `WHERE ${idInJson("r.id")}`, bindings: [JSON.stringify(await matchReleaseIds(db, search, "all"))] }
    : { where: "", bindings: [] };
}

export async function listAdminReleases(db: D1Database, query?: string, limit = 500, offset = 0): Promise<AdminReleaseSummary[]> {
  const { where, bindings } = await adminReleaseWhere(db, query);
  const result = await db.prepare(`${adminReleaseSelect}
    ${where}
    ORDER BY r.release_date DESC, r.title COLLATE NOCASE ASC, r.id ASC
    LIMIT ? OFFSET ?
  `).bind(...bindings, pageLimit(limit), pageOffset(offset)).all<AdminReleaseRow>();
  return result.results.map(mapRelease);
}

export async function countAdminReleases(db: D1Database, query?: string): Promise<number> {
  const { where, bindings } = await adminReleaseWhere(db, query);
  return countRows(db, `SELECT COUNT(*) AS total FROM releases r ${where}`, bindings);
}

export async function getAdminReleaseById(db: D1Database, id: string): Promise<AdminReleaseDetail | null> {
  const row = await db.prepare(`${adminReleaseSelect} WHERE r.id = ?`).bind(id).first<AdminReleaseRow>();
  if (!row) return null;
  const release = mapRelease(row);
  const [tracksResult, sources, appleAlbum, aliasesResult] = await Promise.all([
    db.prepare(`
      SELECT rt.id, rt.disc_number, rt.track_number, rt.display_title, rt.notes,
        s.id AS song_id, s.slug AS song_slug, s.title AS song_title,
        sv.id AS version_id, sv.slug AS version_slug, sv.title AS version_title, sv.version_label,
        (SELECT COUNT(DISTINCT se.setlist_id) FROM setlist_entries se WHERE se.song_id = s.id) AS work_show_count,
        (SELECT COUNT(DISTINCT se.setlist_id) FROM setlist_entries se WHERE se.performed_version_id = sv.id) AS exact_version_show_count,
        tam.external_id AS apple_music_track_id, tyt.external_id AS youtube_video_id
      FROM release_tracks rt
      JOIN song_versions sv ON sv.id = rt.song_version_id
      JOIN songs s ON s.id = sv.song_id
      LEFT JOIN release_track_external_ids tam ON tam.release_track_id = rt.id AND tam.provider = 'apple_music'
      LEFT JOIN release_track_external_ids tyt ON tyt.release_track_id = rt.id AND tyt.provider = 'youtube'
      WHERE rt.release_id = ?
      ORDER BY rt.disc_number ASC, rt.track_number ASC
    `).bind(id).all<ReleaseTrackRecord>(),
    listSources(db, "release", id),
    db.prepare("SELECT external_id, storefront FROM release_external_ids WHERE release_id = ? AND provider = 'apple_music'")
      .bind(id).first<{ external_id: string; storefront: string | null }>(),
    db.prepare("SELECT alias FROM release_aliases WHERE release_id = ? ORDER BY alias COLLATE NOCASE ASC").bind(id).all<{ alias: string }>(),
  ]);
  return {
    ...release,
    aliases: aliasesResult.results.map((row) => row.alias),
    tracks: tracksResult.results,
    sources,
    apple_music_album_id: appleAlbum?.external_id ?? null,
    apple_music_storefront: appleAlbum?.storefront ?? null,
  };
}

/** Follow-up work an editor looks for in the Setlist list: hidden drafts and lists that still need checking. */
const ADMIN_SETLIST_FOLLOW_UPS = {
  draft: "sl.published = 0",
  incomplete: "sl.completeness <> 'complete'",
  unverified: "sl.confidence = 'unverified'",
  empty: "NOT EXISTS (SELECT 1 FROM setlist_entries se WHERE se.setlist_id = sl.id)",
} as const;

export type AdminSetlistFollowUp = keyof typeof ADMIN_SETLIST_FOLLOW_UPS;
export const ADMIN_SETLIST_FOLLOW_UP_KEYS = Object.keys(ADMIN_SETLIST_FOLLOW_UPS) as AdminSetlistFollowUp[];

/** Rows matching the search, by follow-up bucket; `follow_up` counts a Setlist once however many buckets it is in. */
export type AdminSetlistCounts = Record<AdminSetlistFollowUp | "all" | "follow_up", number>;

async function adminSetlistSearch(db: D1Database, query?: string): Promise<{ clauses: string[]; bindings: string[] }> {
  const search = query?.trim();
  return search
    ? { clauses: [idInJson("sl.id")], bindings: [JSON.stringify(await matchSetlistIds(db, search, "all"))] }
    : { clauses: [], bindings: [] };
}

export async function listAdminSetlists(
  db: D1Database, query?: string, limit = 500, options: { offset?: number; followUp?: AdminSetlistFollowUp } = {},
): Promise<AdminSetlistSummary[]> {
  const { clauses, bindings } = await adminSetlistSearch(db, query);
  if (options.followUp) clauses.push(ADMIN_SETLIST_FOLLOW_UPS[options.followUp]);
  const result = await db.prepare(`${adminSetlistSelect}
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY e.start_date DESC, e.start_time DESC, sl.performance_label ASC, sl.id ASC
    LIMIT ? OFFSET ?
  `).bind(...bindings, pageLimit(limit), pageOffset(options.offset ?? 0)).all<AdminSetlistRow>();
  return result.results.map(mapSetlist);
}

export async function countAdminSetlists(db: D1Database, query?: string): Promise<AdminSetlistCounts> {
  const { clauses, bindings } = await adminSetlistSearch(db, query);
  const sums = ADMIN_SETLIST_FOLLOW_UP_KEYS.map((key) => `COALESCE(SUM(${ADMIN_SETLIST_FOLLOW_UPS[key]}), 0) AS ${key}`);
  const any = ADMIN_SETLIST_FOLLOW_UP_KEYS.map((key) => `(${ADMIN_SETLIST_FOLLOW_UPS[key]})`).join(" OR ");
  // Joined to events like the list, so a count never includes a row the list cannot show.
  const row = await db.prepare(`
    SELECT COUNT(*) AS "all", ${sums.join(", ")}, COALESCE(SUM(${any}), 0) AS follow_up
    FROM setlists sl JOIN events e ON e.id = sl.event_id
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
  `).bind(...bindings).first<AdminSetlistCounts>();
  return row ?? { all: 0, draft: 0, incomplete: 0, unverified: 0, empty: 0, follow_up: 0 };
}

export async function getAdminSetlistById(db: D1Database, id: string): Promise<AdminSetlistDetail | null> {
  const row = await db.prepare(`${adminSetlistSelect} WHERE sl.id = ?`).bind(id).first<AdminSetlistRow>();
  if (!row) return null;
  const setlist = mapSetlist(row);
  const [entriesResult, sources] = await Promise.all([
    db.prepare(`
      SELECT se.id, se.position, se.section,
        COALESCE(NULLIF(TRIM(se.display_title), ''), pv.title, s.title) AS display_title,
        se.medley_group, se.notes,
        s.id AS song_id, s.slug AS song_slug, s.title AS song_title,
        pv.id AS performed_version_id, pv.slug AS performed_version_slug,
        pv.title AS performed_version_title, pv.version_label AS performed_version_label,
        (SELECT COUNT(*) FROM song_versions sv WHERE sv.song_id = s.id) AS song_version_count,
        (SELECT r.title
          FROM release_tracks rt
          JOIN releases r ON r.id = rt.release_id
          WHERE rt.song_version_id = se.performed_version_id
          ORDER BY r.release_date IS NULL ASC, r.release_date ASC,
            rt.disc_number ASC, rt.track_number ASC, r.title COLLATE NOCASE ASC
          LIMIT 1) AS release_titles
      FROM setlist_entries se
      JOIN songs s ON s.id = se.song_id
      LEFT JOIN song_versions pv ON pv.id = se.performed_version_id
      WHERE se.setlist_id = ?
      ORDER BY se.position ASC
    `).bind(id).all<SetlistEntryRecord>(),
    listSources(db, "setlist", id),
  ]);
  return { ...setlist, entries: entriesResult.results, sources };
}

export async function getMusicEditorOptions(db: D1Database): Promise<MusicEditorOptions> {
  const [songs, versions, events] = await Promise.all([
    db.prepare(`SELECT s.id, s.slug, s.title,
      (SELECT GROUP_CONCAT(a.alias, char(10)) FROM song_aliases a WHERE a.song_id = s.id) AS aliases
      FROM songs s ORDER BY s.title COLLATE NOCASE ASC`).all<MusicEditorOptions["songs"][number]>(),
    db.prepare(`
      SELECT id, song_id, slug, title, version_label
      FROM song_versions
      ORDER BY title COLLATE NOCASE ASC
    `).all<MusicEditorOptions["versions"][number]>(),
    db.prepare(`
      SELECT e.id, e.slug, e.title, e.start_date, e.classification,
        (SELECT COUNT(*) FROM setlists sl WHERE sl.event_id = e.id) AS setlist_count
      FROM events e
      WHERE e.archived_at IS NULL
      ORDER BY e.start_date DESC, e.title COLLATE NOCASE ASC
    `).all<MusicEditorOptions["events"][number]>(),
  ]);
  return { songs: songs.results, versions: versions.results, events: events.results };
}
