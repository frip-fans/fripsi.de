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

function likePattern(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

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
  SELECT s.id, s.slug, s.title, s.original_artist, s.first_release_date, s.notes, s.published,
    s.created_at, s.updated_at,
    (SELECT COUNT(*) FROM song_versions sv WHERE sv.song_id = s.id) AS version_count,
    (SELECT COUNT(DISTINCT rt.release_id)
      FROM song_versions sv JOIN release_tracks rt ON rt.song_version_id = sv.id
      WHERE sv.song_id = s.id) AS release_count,
    (SELECT COUNT(DISTINCT se.setlist_id) FROM setlist_entries se WHERE se.song_id = s.id) AS show_count,
    (SELECT COUNT(*) FROM setlist_entries se WHERE se.song_id = s.id) AS performance_count
  FROM songs s
`;

export async function listAdminSongs(db: D1Database, query?: string, limit = 500): Promise<AdminSongSummary[]> {
  const search = query?.trim();
  const pattern = search ? likePattern(search) : null;
  const where = search ? `WHERE s.title LIKE ? ESCAPE '\\' OR s.original_artist LIKE ? ESCAPE '\\'
    OR s.slug LIKE ? ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM song_aliases sa WHERE sa.song_id = s.id AND sa.alias LIKE ? ESCAPE '\\'
    )` : "";
  const bindings = pattern ? [pattern, pattern, pattern, pattern] : [];
  const result = await db.prepare(`${adminSongSelect}
    ${where}
    ORDER BY s.updated_at DESC, s.title COLLATE NOCASE ASC
    LIMIT ?
  `).bind(...bindings, Math.max(1, Math.min(limit, 500))).all<AdminSongRow>();
  return result.results.map(mapSong);
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
  SELECT sl.*, e.slug AS event_slug, e.title AS event_title, e.category AS event_category,
    e.classification AS event_classification, e.start_date, e.start_time, e.venue, e.region,
    (SELECT COUNT(*) FROM setlist_entries se WHERE se.setlist_id = sl.id) AS entry_count
  FROM setlists sl
  JOIN events e ON e.id = sl.event_id
`;

export async function listAdminReleases(db: D1Database, query?: string, limit = 500): Promise<AdminReleaseSummary[]> {
  const search = query?.trim();
  const where = search ? "WHERE r.title LIKE ? ESCAPE '\\' OR r.catalog_number LIKE ? ESCAPE '\\' OR r.slug LIKE ? ESCAPE '\\'" : "";
  const bindings = search ? [likePattern(search), likePattern(search), likePattern(search)] : [];
  const result = await db.prepare(`${adminReleaseSelect}
    ${where}
    ORDER BY r.release_date DESC, r.title COLLATE NOCASE ASC
    LIMIT ?
  `).bind(...bindings, Math.max(1, Math.min(limit, 500))).all<AdminReleaseRow>();
  return result.results.map(mapRelease);
}

export async function getAdminReleaseById(db: D1Database, id: string): Promise<AdminReleaseDetail | null> {
  const row = await db.prepare(`${adminReleaseSelect} WHERE r.id = ?`).bind(id).first<AdminReleaseRow>();
  if (!row) return null;
  const release = mapRelease(row);
  const [tracksResult, sources] = await Promise.all([
    db.prepare(`
      SELECT rt.id, rt.disc_number, rt.track_number, rt.display_title, rt.notes,
        s.id AS song_id, s.slug AS song_slug, s.title AS song_title,
        sv.id AS version_id, sv.slug AS version_slug, sv.title AS version_title, sv.version_label,
        (SELECT COUNT(DISTINCT se.setlist_id) FROM setlist_entries se WHERE se.song_id = s.id) AS work_show_count,
        (SELECT COUNT(DISTINCT se.setlist_id) FROM setlist_entries se WHERE se.performed_version_id = sv.id) AS exact_version_show_count
      FROM release_tracks rt
      JOIN song_versions sv ON sv.id = rt.song_version_id
      JOIN songs s ON s.id = sv.song_id
      WHERE rt.release_id = ?
      ORDER BY rt.disc_number ASC, rt.track_number ASC
    `).bind(id).all<ReleaseTrackRecord>(),
    listSources(db, "release", id),
  ]);
  return { ...release, tracks: tracksResult.results, sources };
}

export async function listAdminSetlists(db: D1Database, query?: string, limit = 500): Promise<AdminSetlistSummary[]> {
  const search = query?.trim();
  const pattern = search ? likePattern(search) : null;
  const where = search ? "WHERE e.title LIKE ? ESCAPE '\\' OR sl.title LIKE ? ESCAPE '\\' OR e.venue LIKE ? ESCAPE '\\'" : "";
  const bindings = pattern ? [pattern, pattern, pattern] : [];
  const result = await db.prepare(`${adminSetlistSelect}
    ${where}
    ORDER BY e.start_date DESC, e.start_time DESC, sl.performance_label ASC
    LIMIT ?
  `).bind(...bindings, Math.max(1, Math.min(limit, 500))).all<AdminSetlistRow>();
  return result.results.map(mapSetlist);
}

export async function getAdminSetlistById(db: D1Database, id: string): Promise<AdminSetlistDetail | null> {
  const row = await db.prepare(`${adminSetlistSelect} WHERE sl.id = ?`).bind(id).first<AdminSetlistRow>();
  if (!row) return null;
  const setlist = mapSetlist(row);
  const [entriesResult, sources] = await Promise.all([
    db.prepare(`
      SELECT se.id, se.position, se.section, se.display_title, se.medley_group, se.notes,
        s.id AS song_id, s.slug AS song_slug, s.title AS song_title,
        pv.id AS performed_version_id, pv.slug AS performed_version_slug,
        pv.title AS performed_version_title, pv.version_label AS performed_version_label,
        (SELECT COUNT(*) FROM song_versions sv WHERE sv.song_id = s.id) AS song_version_count,
        (SELECT group_concat(DISTINCT r.title)
          FROM release_tracks rt JOIN releases r ON r.id = rt.release_id
          WHERE rt.song_version_id = se.performed_version_id) AS release_titles
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
    db.prepare("SELECT id, slug, title FROM songs ORDER BY title COLLATE NOCASE ASC").all<MusicEditorOptions["songs"][number]>(),
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
