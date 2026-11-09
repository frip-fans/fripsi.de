/** One performed song, in archive order (setlist date, start time, setlist id, position). */
export interface SetlistHighlightRow {
  setlist_id: string;
  start_date: string;
  song_id: string;
  song_title: string;
  display_title: string;
  first_release_date: string | null;
}

export interface SetlistSongReturn {
  song_id: string;
  title: string;
  /** Whole days since the previous archived performance of this song. */
  gap_days: number;
  previous_date: string;
}

export interface SetlistHighlights {
  /** Songs performed live for the first time in the archive. */
  debuts: Array<{ song_id: string; title: string }>;
  /** Songs back after at least the configured gap, longest gap first. */
  returns: SetlistSongReturn[];
  /** Song titles (without version suffixes) in performance order, with repeats (medley reprises) removed. */
  songs: string[];
}

export interface SetlistHighlightOptions {
  /** Minimum gap for a "return" highlight. */
  returnGapDays?: number;
}

export const DEFAULT_RETURN_GAP_DAYS = 365 * 2;
const DAY_MS = 86_400_000;

/**
 * Walk every archived performance in order and derive debuts and long-gap returns.
 * A first appearance only counts as a debut when the song was released on or after the
 * archive's first setlist; older songs were surely performed before the records start.
 */
export function computeSetlistHighlights(rows: readonly SetlistHighlightRow[], options: SetlistHighlightOptions = {}): Map<string, SetlistHighlights> {
  const gapDays = options.returnGapDays ?? DEFAULT_RETURN_GAP_DAYS;
  const archiveStart = rows[0]?.start_date ?? "";
  const lastPerformed = new Map<string, string>();
  const result = new Map<string, SetlistHighlights>();
  let current: { id: string; date: string; seen: Set<string>; highlights: SetlistHighlights } | undefined;
  const finish = () => {
    if (!current) return;
    current.highlights.returns.sort((a, b) => b.gap_days - a.gap_days || a.title.localeCompare(b.title));
    for (const songId of current.seen) lastPerformed.set(songId, current.date);
    result.set(current.id, current.highlights);
  };
  for (const row of rows) {
    if (current?.id !== row.setlist_id) {
      finish();
      current = { id: row.setlist_id, date: row.start_date, seen: new Set(), highlights: { debuts: [], returns: [], songs: [] } };
    }
    if (current.seen.has(row.song_id)) continue;
    current.seen.add(row.song_id);
    current.highlights.songs.push(row.song_title);
    const previous = lastPerformed.get(row.song_id);
    if (!previous) {
      if (row.first_release_date && row.first_release_date >= archiveStart) current.highlights.debuts.push({ song_id: row.song_id, title: row.song_title });
      continue;
    }
    const gap = Math.round((Date.parse(`${row.start_date}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`)) / DAY_MS);
    if (gap >= gapDays) current.highlights.returns.push({ song_id: row.song_id, title: row.song_title, gap_days: gap, previous_date: previous });
  }
  finish();
  return result;
}
