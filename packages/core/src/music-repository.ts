import type {
  CatalogSource,
  MusicLibraryOverview,
  MusicLibraryStats,
  MusicSearchOptions,
  ReleaseDetail,
  ReleaseSearchOptions,
  ReleaseSummary,
  ReleaseTrackRecord,
  SetlistDetail,
  SetlistBrowseSummary,
  SetlistEntryRecord,
  SetlistSearchOptions,
  SetlistSummary,
  SongDetail,
  SongBrowseSummary,
  SongPerformance,
  SongReleaseAppearance,
  SongSummary,
  SongVersionRecord,
  VersionRelationRecord,
} from "./music-types";

function safeLimit(value: number | undefined, fallback = 100, maximum = 500): number {
  return Math.max(1, Math.min(value ?? fallback, maximum));
}

function safeOffset(value: number | undefined): number {
  return Math.max(0, Math.min(Math.floor(value ?? 0), 1_000_000));
}

function likePattern(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function eventVenueDisplay(eventAlias: string): string {
  return `(SELECT GROUP_CONCAT(COALESCE(ev.display_name_snapshot, v.canonical_name), ' / ')
    FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
    WHERE ev.event_id = ${eventAlias}.id ORDER BY ev.position)`;
}

function eventAreaDisplay(eventAlias: string): string {
  return `(SELECT GROUP_CONCAT(area_name, ' / ') FROM (
    SELECT DISTINCT a.name_local AS area_name
    FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
    JOIN administrative_areas a ON a.id = v.administrative_area_id
    WHERE ev.event_id = ${eventAlias}.id ORDER BY ev.position
  ))`;
}

async function getCatalogSources(
  db: D1Database,
  subjectType: CatalogSource["subject_type"],
  subjectId: string,
): Promise<CatalogSource[]> {
  const result = await db.prepare(`
    SELECT * FROM catalog_sources
    WHERE subject_type = ? AND subject_id = ?
    ORDER BY verified_at IS NULL ASC, created_at ASC
  `).bind(subjectType, subjectId).all<CatalogSource>();
  return result.results;
}

const songSummarySelect = `
  SELECT s.id, s.slug, s.title, s.original_artist, s.first_release_date, s.notes,
    (SELECT COUNT(*) FROM song_versions sv WHERE sv.song_id = s.id AND sv.published = 1) AS version_count,
    (SELECT COUNT(DISTINCT rt.release_id)
      FROM song_versions sv
      JOIN release_tracks rt ON rt.song_version_id = sv.id
      JOIN releases r ON r.id = rt.release_id AND r.published = 1
      WHERE sv.song_id = s.id AND sv.published = 1) AS release_count,
    (SELECT COUNT(DISTINCT se.setlist_id)
      FROM setlist_entries se
      JOIN setlists sl ON sl.id = se.setlist_id AND sl.published = 1
      JOIN events e ON e.id = sl.event_id AND e.published = 1 AND e.archived_at IS NULL
      WHERE se.song_id = s.id) AS show_count,
    (SELECT COUNT(*)
      FROM setlist_entries se
      JOIN setlists sl ON sl.id = se.setlist_id AND sl.published = 1
      JOIN events e ON e.id = sl.event_id AND e.published = 1 AND e.archived_at IS NULL
      WHERE se.song_id = s.id) AS performance_count
  FROM songs s
`;

const releaseSummarySelect = `
  SELECT r.id, r.slug, r.title, r.release_type, r.release_date, r.catalog_number, r.edition, r.notes, r.cover_url, r.cover_source_url,
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

const setlistSummarySelect = `
  SELECT sl.id, sl.event_id, sl.performance_label, sl.title, sl.completeness, sl.confidence, sl.notes,
    e.slug AS event_slug, e.title AS event_title, e.category AS event_category,
    e.classification AS event_classification, e.start_date, e.start_time,
    ${eventVenueDisplay("e")} AS venue, ${eventAreaDisplay("e")} AS region,
    (SELECT COUNT(*) FROM setlist_entries se WHERE se.setlist_id = sl.id) AS entry_count
  FROM setlists sl
  JOIN events e ON e.id = sl.event_id
`;

function buildSongFilter(options: MusicSearchOptions): { where: string; bindings: unknown[] } {
  const bindings: unknown[] = [];
  let where = "WHERE s.published = 1";
  if (options.query?.trim()) {
    const pattern = likePattern(options.query.trim());
    where += ` AND (s.title LIKE ? ESCAPE '\\' OR s.original_artist LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM song_aliases sa WHERE sa.song_id = s.id AND sa.alias LIKE ? ESCAPE '\\'))`;
    bindings.push(pattern, pattern, pattern);
  }
  return { where, bindings };
}

function buildSetlistFilter(options: SetlistSearchOptions): { where: string; bindings: unknown[] } {
  const clauses = ["sl.published = 1", "e.published = 1", "e.archived_at IS NULL"];
  const bindings: unknown[] = [];
  if (options.query?.trim()) {
    const pattern = likePattern(options.query.trim());
    clauses.push(`(e.title LIKE ? ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
        LEFT JOIN administrative_areas a ON a.id = v.administrative_area_id
        WHERE ev.event_id = e.id AND (v.canonical_name LIKE ? ESCAPE '\\' OR a.name_local LIKE ? ESCAPE '\\')
      )
      OR sl.title LIKE ? ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM setlist_entries se
        JOIN songs s ON s.id = se.song_id
        WHERE se.setlist_id = sl.id AND (se.display_title LIKE ? ESCAPE '\\' OR s.title LIKE ? ESCAPE '\\')
      ))`);
    bindings.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (options.year?.match(/^\d{4}$/)) {
    const nextYear = String(Number(options.year) + 1).padStart(4, "0");
    clauses.push("e.start_date >= ? AND e.start_date < ?");
    bindings.push(`${options.year}-01-01`, `${nextYear}-01-01`);
  }
  if (options.classification?.trim()) {
    clauses.push("e.classification = ?");
    bindings.push(options.classification.trim());
  }
  return { where: `WHERE ${clauses.join(" AND ")}`, bindings };
}

export async function getMusicLibraryStats(db: D1Database): Promise<MusicLibraryStats> {
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM songs WHERE published = 1) AS song_count,
      (SELECT COUNT(*) FROM song_versions WHERE published = 1) AS version_count,
      (SELECT COUNT(*) FROM releases WHERE published = 1) AS release_count,
      (SELECT COUNT(*) FROM setlists sl
        JOIN events e ON e.id = sl.event_id
        WHERE sl.published = 1 AND e.published = 1 AND e.archived_at IS NULL) AS setlist_count,
      (SELECT COUNT(*) FROM setlist_entries se
        JOIN setlists sl ON sl.id = se.setlist_id
        JOIN events e ON e.id = sl.event_id
        WHERE sl.published = 1 AND e.published = 1 AND e.archived_at IS NULL) AS performance_count
  `).first<MusicLibraryStats>();

  return row ?? { song_count: 0, version_count: 0, release_count: 0, setlist_count: 0, performance_count: 0 };
}

export async function listSongs(db: D1Database, options: MusicSearchOptions = {}): Promise<SongSummary[]> {
  const { where, bindings } = buildSongFilter(options);

  const result = await db.prepare(`${songSummarySelect}
    ${where}
    ORDER BY performance_count DESC, s.first_release_date DESC, s.title COLLATE NOCASE ASC
    LIMIT ? OFFSET ?
  `).bind(...bindings, safeLimit(options.limit), safeOffset(options.offset)).all<SongSummary>();
  return result.results;
}

export async function listSongCatalog(db: D1Database, limit = 500): Promise<SongBrowseSummary[]> {
  const result = await db.prepare(`
    SELECT s.id, s.slug, s.title, s.original_artist, s.first_release_date, s.notes,
      (SELECT COUNT(*) FROM song_versions sv WHERE sv.song_id = s.id AND sv.published = 1) AS version_count,
      (SELECT COUNT(DISTINCT rt.release_id)
        FROM song_versions sv
        JOIN release_tracks rt ON rt.song_version_id = sv.id
        JOIN releases r ON r.id = rt.release_id AND r.published = 1
        WHERE sv.song_id = s.id AND sv.published = 1) AS release_count,
      (SELECT COUNT(DISTINCT se.setlist_id)
        FROM setlist_entries se
        JOIN setlists sl ON sl.id = se.setlist_id AND sl.published = 1
        JOIN events e ON e.id = sl.event_id AND e.published = 1 AND e.archived_at IS NULL
        WHERE se.song_id = s.id) AS show_count,
      (SELECT COUNT(*)
        FROM setlist_entries se
        JOIN setlists sl ON sl.id = se.setlist_id AND sl.published = 1
        JOIN events e ON e.id = sl.event_id AND e.published = 1 AND e.archived_at IS NULL
        WHERE se.song_id = s.id) AS performance_count,
      TRIM(s.title || ' ' || s.original_artist || ' ' || COALESCE((
        SELECT GROUP_CONCAT(sa.alias, ' ')
        FROM song_aliases sa
        WHERE sa.song_id = s.id
      ), '')) AS search_text
    FROM songs s
    WHERE s.published = 1
    ORDER BY performance_count DESC, s.first_release_date DESC, s.title COLLATE NOCASE ASC
    LIMIT ?
  `).bind(safeLimit(limit, 500, 500)).all<SongBrowseSummary>();
  return result.results;
}

export async function countSongs(db: D1Database, options: MusicSearchOptions = {}): Promise<number> {
  const { where, bindings } = buildSongFilter(options);
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM songs s ${where}`)
    .bind(...bindings)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function getSongBySlug(db: D1Database, slug: string): Promise<SongDetail | null> {
  const song = await db.prepare(`${songSummarySelect} WHERE s.slug = ? AND s.published = 1`).bind(slug).first<SongSummary>();
  if (!song) return null;

  const [aliasesResult, versionsResult, relationsResult, releasesResult, performancesResult, sources] = await Promise.all([
    db.prepare("SELECT alias FROM song_aliases WHERE song_id = ? ORDER BY alias COLLATE NOCASE ASC").bind(song.id).all<{ alias: string }>(),
    db.prepare(`
      SELECT id, song_id, slug, title, version_label, artist_credit, release_date, notes
      FROM song_versions WHERE song_id = ? AND published = 1
      ORDER BY release_date IS NULL ASC, release_date ASC, title COLLATE NOCASE ASC
    `).bind(song.id).all<SongVersionRecord>(),
    db.prepare(`
      SELECT svr.id, svr.child_version_id, child.slug AS child_version_slug, child.title AS child_version_title,
        svr.parent_version_id, parent.slug AS parent_version_slug, parent.title AS parent_version_title,
        svr.relation_type, svr.notes
      FROM song_version_relations svr
      JOIN song_versions child ON child.id = svr.child_version_id AND child.published = 1
      JOIN song_versions parent ON parent.id = svr.parent_version_id AND parent.published = 1
      WHERE child.song_id = ? OR parent.song_id = ?
      ORDER BY child.release_date ASC, child.title COLLATE NOCASE ASC
    `).bind(song.id, song.id).all<VersionRelationRecord>(),
    db.prepare(`
      SELECT r.id AS release_id, r.slug AS release_slug, r.title AS release_title, r.release_type,
        r.release_date, r.edition, rt.disc_number, rt.track_number, rt.display_title,
        sv.id AS version_id, sv.slug AS version_slug, sv.title AS version_title, sv.version_label
      FROM release_tracks rt
      JOIN releases r ON r.id = rt.release_id AND r.published = 1
      JOIN song_versions sv ON sv.id = rt.song_version_id AND sv.published = 1
      WHERE sv.song_id = ?
      ORDER BY r.release_date DESC, r.title COLLATE NOCASE ASC, rt.disc_number ASC, rt.track_number ASC
    `).bind(song.id).all<SongReleaseAppearance>(),
    db.prepare(`
      SELECT sl.id AS setlist_id, sl.performance_label, e.slug AS event_slug, e.title AS event_title,
        e.start_date, ${eventVenueDisplay("e")} AS venue, ${eventAreaDisplay("e")} AS region,
        se.position, se.section, se.display_title,
        se.performed_version_id, pv.slug AS performed_version_slug, pv.title AS performed_version_title,
        se.medley_group
      FROM setlist_entries se
      JOIN setlists sl ON sl.id = se.setlist_id AND sl.published = 1
      JOIN events e ON e.id = sl.event_id AND e.published = 1 AND e.archived_at IS NULL
      LEFT JOIN song_versions pv ON pv.id = se.performed_version_id AND pv.published = 1
      WHERE se.song_id = ?
      ORDER BY e.start_date DESC, e.start_time DESC, sl.performance_label ASC, se.position ASC
    `).bind(song.id).all<SongPerformance>(),
    getCatalogSources(db, "song", song.id),
  ]);

  return {
    ...song,
    aliases: aliasesResult.results.map((row) => row.alias),
    versions: versionsResult.results,
    relations: relationsResult.results,
    releases: releasesResult.results,
    performances: performancesResult.results,
    sources,
  };
}

export async function listReleases(db: D1Database, options: ReleaseSearchOptions = {}): Promise<ReleaseSummary[]> {
  const clauses = ["r.published = 1"];
  const bindings: unknown[] = [];
  if (options.query?.trim()) {
    const pattern = likePattern(options.query.trim());
    clauses.push("(r.title LIKE ? ESCAPE '\\' OR r.catalog_number LIKE ? ESCAPE '\\' OR r.edition LIKE ? ESCAPE '\\')");
    bindings.push(pattern, pattern, pattern);
  }
  if (options.type) {
    clauses.push("r.release_type = ?");
    bindings.push(options.type);
  }

  const result = await db.prepare(`${releaseSummarySelect}
    WHERE ${clauses.join(" AND ")}
    ORDER BY r.release_date DESC, r.title COLLATE NOCASE ASC
    LIMIT ?
  `).bind(...bindings, safeLimit(options.limit)).all<ReleaseSummary>();
  return result.results;
}

export async function getReleaseBySlug(db: D1Database, slug: string): Promise<ReleaseDetail | null> {
  const release = await db.prepare(`${releaseSummarySelect} WHERE r.slug = ? AND r.published = 1`).bind(slug).first<ReleaseSummary>();
  if (!release) return null;

  const [tracksResult, sources] = await Promise.all([
    db.prepare(`
      SELECT rt.id, rt.disc_number, rt.track_number, rt.display_title, rt.notes,
        s.id AS song_id, s.slug AS song_slug, s.title AS song_title,
        sv.id AS version_id, sv.slug AS version_slug, sv.title AS version_title, sv.version_label,
        (SELECT COUNT(DISTINCT se.setlist_id)
          FROM setlist_entries se
          JOIN setlists sl ON sl.id = se.setlist_id AND sl.published = 1
          JOIN events e ON e.id = sl.event_id AND e.published = 1 AND e.archived_at IS NULL
          WHERE se.song_id = s.id) AS work_show_count,
        (SELECT COUNT(DISTINCT se.setlist_id)
          FROM setlist_entries se
          JOIN setlists sl ON sl.id = se.setlist_id AND sl.published = 1
          JOIN events e ON e.id = sl.event_id AND e.published = 1 AND e.archived_at IS NULL
          WHERE se.performed_version_id = sv.id) AS exact_version_show_count
      FROM release_tracks rt
      JOIN song_versions sv ON sv.id = rt.song_version_id AND sv.published = 1
      JOIN songs s ON s.id = sv.song_id AND s.published = 1
      WHERE rt.release_id = ?
      ORDER BY rt.disc_number ASC, rt.track_number ASC
    `).bind(release.id).all<ReleaseTrackRecord>(),
    getCatalogSources(db, "release", release.id),
  ]);

  return { ...release, tracks: tracksResult.results, sources };
}

export async function listSetlists(db: D1Database, options: SetlistSearchOptions = {}): Promise<SetlistSummary[]> {
  const { where, bindings } = buildSetlistFilter(options);
  const direction = options.order === "asc" ? "ASC" : "DESC";

  const result = await db.prepare(`${setlistSummarySelect}
    ${where}
    ORDER BY e.start_date ${direction}, e.start_time ${direction}, sl.performance_label ASC
    LIMIT ? OFFSET ?
  `).bind(...bindings, safeLimit(options.limit), safeOffset(options.offset)).all<SetlistSummary>();
  return result.results;
}

export async function listSetlistsForYear(
  db: D1Database,
  year: string,
  limit = 100,
): Promise<SetlistBrowseSummary[]> {
  if (!/^\d{4}$/.test(year)) return [];
  const nextYear = String(Number(year) + 1).padStart(4, "0");
  const result = await db.prepare(`
    SELECT sl.id, sl.event_id, sl.performance_label, sl.title, sl.completeness, sl.confidence, sl.notes,
      e.slug AS event_slug, e.title AS event_title, e.category AS event_category,
      e.classification AS event_classification, e.start_date, e.start_time,
      ${eventVenueDisplay("e")} AS venue, ${eventAreaDisplay("e")} AS region,
      (SELECT COUNT(*) FROM setlist_entries se WHERE se.setlist_id = sl.id) AS entry_count,
    COALESCE((
      SELECT GROUP_CONCAT(COALESCE(NULLIF(se.display_title, ''), s.title), ' ')
      FROM setlist_entries se
      JOIN songs s ON s.id = se.song_id
      WHERE se.setlist_id = sl.id
    ), '') AS search_text
    FROM setlists sl
    JOIN events e ON e.id = sl.event_id
    WHERE sl.published = 1 AND e.published = 1 AND e.archived_at IS NULL
      AND e.start_date >= ? AND e.start_date < ?
    ORDER BY e.start_date DESC, e.start_time DESC, sl.performance_label ASC
    LIMIT ?
  `).bind(`${year}-01-01`, `${nextYear}-01-01`, safeLimit(limit, 100, 100)).all<SetlistBrowseSummary>();
  return result.results;
}

export async function countSetlists(db: D1Database, options: SetlistSearchOptions = {}): Promise<number> {
  const { where, bindings } = buildSetlistFilter(options);
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM setlists sl
    JOIN events e ON e.id = sl.event_id
    ${where}
  `).bind(...bindings).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function listSetlistYears(
  db: D1Database,
  options: SetlistSearchOptions = {},
): Promise<Array<{ year: string; count: number }>> {
  const { where, bindings } = buildSetlistFilter({ ...options, year: undefined });
  const result = await db.prepare(`
    SELECT substr(e.start_date, 1, 4) AS year, COUNT(*) AS count
    FROM setlists sl
    JOIN events e ON e.id = sl.event_id
    ${where}
    GROUP BY substr(e.start_date, 1, 4)
    ORDER BY year DESC
  `).bind(...bindings).all<{ year: string; count: number }>();
  return result.results;
}

export async function getSetlistById(db: D1Database, id: string): Promise<SetlistDetail | null> {
  const setlist = await db.prepare(`${setlistSummarySelect}
    WHERE sl.id = ? AND sl.published = 1 AND e.published = 1 AND e.archived_at IS NULL
  `).bind(id).first<SetlistSummary>();
  if (!setlist) return null;

  const [entriesResult, sources] = await Promise.all([
    db.prepare(`
      SELECT se.id, se.position, se.section,
        COALESCE(NULLIF(TRIM(se.display_title), ''), pv.title, s.title) AS display_title,
        se.medley_group, se.notes,
        s.id AS song_id, s.slug AS song_slug, s.title AS song_title,
        pv.id AS performed_version_id, pv.slug AS performed_version_slug,
        pv.title AS performed_version_title, pv.version_label AS performed_version_label,
        (SELECT COUNT(*) FROM song_versions sv
          WHERE sv.song_id = s.id AND sv.published = 1) AS song_version_count,
        (SELECT r.title
          FROM release_tracks rt
          JOIN releases r ON r.id = rt.release_id AND r.published = 1
          WHERE rt.song_version_id = se.performed_version_id
          ORDER BY r.release_date IS NULL ASC, r.release_date ASC,
            rt.disc_number ASC, rt.track_number ASC, r.title COLLATE NOCASE ASC
          LIMIT 1) AS release_titles
      FROM setlist_entries se
      JOIN songs s ON s.id = se.song_id AND s.published = 1
      LEFT JOIN song_versions pv ON pv.id = se.performed_version_id AND pv.published = 1
      WHERE se.setlist_id = ?
      ORDER BY se.position ASC
    `).bind(setlist.id).all<SetlistEntryRecord>(),
    getCatalogSources(db, "setlist", setlist.id),
  ]);

  return { ...setlist, entries: entriesResult.results, sources };
}

export async function listPublicSetlistsForEvent(db: D1Database, eventId: string): Promise<SetlistSummary[]> {
  const result = await db.prepare(`${setlistSummarySelect}
    WHERE sl.event_id = ? AND sl.published = 1 AND e.published = 1 AND e.archived_at IS NULL
    ORDER BY sl.performance_label ASC
  `).bind(eventId).all<SetlistSummary>();
  return result.results;
}

export async function getMusicLibraryOverview(db: D1Database): Promise<MusicLibraryOverview> {
  const [stats, topSongs, recentReleases, recentSetlists] = await Promise.all([
    getMusicLibraryStats(db),
    listSongs(db, { limit: 8 }),
    listReleases(db, { limit: 6 }),
    listSetlists(db, { limit: 6 }),
  ]);
  return { stats, top_songs: topSongs, recent_releases: recentReleases, recent_setlists: recentSetlists };
}
