import { countPublicSetlistsSince, listSetlistYears } from "./music-repository";

export interface SpotlightPerformance {
  setlist_id: string;
  start_date: string;
  title: string | null;
  event_title: string;
  performance_label: string;
}

export interface SpotlightYear {
  year: string;
  /** Archived setlists that year. */
  total: number;
  /** Archived setlists that year containing this song. */
  sung: number;
}

export interface SpotlightRelease {
  slug: string;
  title: string;
  cover_url: string | null;
}

export interface SongSpotlight {
  slug: string;
  title: string;
  original_artist: string;
  first_release_date: string | null;
  release_count: number;
  /** The release the card shows art for: one with a cover if there is one, else the earliest. */
  release: SpotlightRelease | null;
  /** Archived setlists containing the song; a medley reprise counts once. */
  show_count: number;
  first_performance: SpotlightPerformance | null;
  last_performance: SpotlightPerformance | null;
  /** Archived setlists since the song became available, the denominator of the performance rate. */
  shows_since_release: number;
  /** Archived setlists after the last performance — how long the song has been rested. */
  shows_since_last: number;
  years: SpotlightYear[];
}

const performedSetlists = `
  FROM setlist_entries se
  JOIN setlists sl ON sl.id = se.setlist_id AND sl.published = 1
  JOIN events e ON e.id = sl.event_id AND e.published = 1 AND e.archived_at IS NULL
`;

const boundarySelect = `
  SELECT sl.id AS setlist_id, e.start_date, sl.title, e.title AS event_title, sl.performance_label
  ${performedSetlists}
  WHERE se.song_id = ?
`;

/**
 * Pick the same index for the same seed, so a daily spotlight stays put all day and for every
 * visitor and language, instead of reshuffling on each server render.
 */
export function pickSpotlightIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash % length;
}

/**
 * One performed song with the numbers the song page shows, picked deterministically from `seed`
 * (a date string in practice). Songs without an archived performance are skipped: a spotlight with
 * every stat empty is not worth a card.
 */
export async function getSongSpotlight(db: D1Database, seed: string): Promise<SongSpotlight | null> {
  const candidates = await db.prepare(`
    SELECT s.id, s.slug, s.title, s.original_artist, s.first_release_date
    FROM songs s
    WHERE s.published = 1 AND EXISTS (SELECT 1 ${performedSetlists} WHERE se.song_id = s.id)
    ORDER BY s.id ASC
  `).all<{ id: string; slug: string; title: string; original_artist: string; first_release_date: string | null }>();
  const song = candidates.results[pickSpotlightIndex(seed, candidates.results.length)];
  if (!song) return null;

  const [counts, releaseRow, firstRow, lastRow, sungYears, totalYears] = await Promise.all([
    db.prepare(`
      SELECT
        (SELECT COUNT(DISTINCT sl.id) ${performedSetlists} WHERE se.song_id = ?) AS show_count,
        (SELECT COUNT(DISTINCT rt.release_id)
          FROM song_versions sv
          JOIN release_tracks rt ON rt.song_version_id = sv.id
          JOIN releases r ON r.id = rt.release_id AND r.published = 1
          WHERE sv.song_id = ? AND sv.published = 1) AS release_count
    `).bind(song.id, song.id).first<{ show_count: number; release_count: number }>(),
    db.prepare(`
      SELECT r.slug, r.title, r.cover_url
      FROM release_tracks rt
      JOIN releases r ON r.id = rt.release_id AND r.published = 1
      JOIN song_versions sv ON sv.id = rt.song_version_id AND sv.published = 1
      WHERE sv.song_id = ?
      ORDER BY (r.cover_url IS NULL) ASC, r.release_date IS NULL ASC, r.release_date ASC, r.title COLLATE NOCASE ASC
      LIMIT 1
    `).bind(song.id).first<SpotlightRelease>(),
    db.prepare(`${boundarySelect} ORDER BY e.start_date ASC, e.start_time ASC, sl.performance_label ASC, sl.id ASC LIMIT 1`)
      .bind(song.id).first<SpotlightPerformance>(),
    db.prepare(`${boundarySelect} ORDER BY e.start_date DESC, e.start_time DESC, sl.performance_label DESC, sl.id DESC LIMIT 1`)
      .bind(song.id).first<SpotlightPerformance>(),
    db.prepare(`
      SELECT substr(e.start_date, 1, 4) AS year, COUNT(DISTINCT sl.id) AS sung
      ${performedSetlists}
      WHERE se.song_id = ?
      GROUP BY substr(e.start_date, 1, 4)
    `).bind(song.id).all<{ year: string; sung: number }>(),
    listSetlistYears(db),
  ]);

  // The rate counts only shows the song could have appeared at: released songs from their release
  // date, unreleased ones from their live debut.
  const since = song.first_release_date ?? firstRow?.start_date ?? null;
  const [showsSinceRelease, showsSinceLast] = await Promise.all([
    since ? countPublicSetlistsSince(db, since) : Promise.resolve(0),
    lastRow ? countPublicSetlistsAfter(db, lastRow.start_date) : Promise.resolve(0),
  ]);

  const sungByYear = new Map(sungYears.results.map((row) => [row.year, Number(row.sung)]));
  const startYear = (since ?? firstRow?.start_date ?? "").slice(0, 4);
  const years = totalYears
    .filter((row) => !startYear || row.year >= startYear)
    .map((row) => ({ year: row.year, total: Number(row.count), sung: sungByYear.get(row.year) ?? 0 }))
    .sort((a, b) => a.year.localeCompare(b.year));

  return {
    slug: song.slug,
    title: song.title,
    original_artist: song.original_artist,
    first_release_date: song.first_release_date,
    release_count: Number(counts?.release_count ?? 0),
    release: releaseRow ?? null,
    show_count: Number(counts?.show_count ?? 0),
    first_performance: firstRow ?? null,
    last_performance: lastRow ?? null,
    shows_since_release: showsSinceRelease,
    shows_since_last: showsSinceLast,
    years,
  };
}

/** Archived setlists strictly after `date` — the gap since a song was last performed. */
export async function countPublicSetlistsAfter(db: D1Database, date: string): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const row = await db.prepare(`
    SELECT COUNT(*) AS count FROM setlists sl
    JOIN events e ON e.id = sl.event_id
    WHERE sl.published = 1 AND e.published = 1 AND e.archived_at IS NULL AND e.start_date > ?
  `).bind(date).first<{ count: number }>();
  return Number(row?.count ?? 0);
}
