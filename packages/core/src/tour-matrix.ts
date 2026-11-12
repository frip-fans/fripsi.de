/**
 * The song-by-show matrix for one tour. Each published setlist is a column (a stop with day and
 * night shows gets two); a stop without a setlist still gets one column so the gap is visible.
 *
 * Missing data is never read as "not sung":
 * - complete setlist without the song → "absent" (known not sung)
 * - partial / unknown setlist without it → "unknown"
 * - no setlist at all → "missing"
 * Fixed / rotating counts and the baseline only use complete setlists.
 */

export type TourSetlistSection = "main" | "encore" | "double_encore" | "opening" | "other";

export interface TourMatrixShowInput {
  event_id: string;
  event_slug: string;
  start_date: string;
  start_time: string | null;
  /** Stop name: the event's tour_stop, or its area. */
  stop_label: string;
  setlist_id: string | null;
  performance_label: string | null;
  completeness: "complete" | "partial" | "unknown" | null;
}

export interface TourMatrixEntryInput {
  setlist_id: string;
  song_id: string;
  song_slug: string;
  song_title: string;
  position: number;
  section: TourSetlistSection;
}

export type TourCell =
  | { state: "sung"; position: number; section: TourSetlistSection }
  | { state: "absent" | "unknown" | "missing" };

export type TourSongKind = "fixed" | "rotating" | "once";

export interface TourMatrixColumn extends TourMatrixShowInput {
  /** 1-based stop number within the tour (shows of the same event share it). */
  stop_number: number;
  entry_count: number;
}

export interface TourMatrixRow {
  song_id: string;
  song_slug: string;
  song_title: string;
  cells: TourCell[];
  /** Shows that have the song, any completeness. */
  sung_count: number;
  /** Null when fewer than two complete setlists exist. */
  kind: TourSongKind | null;
  in_baseline: boolean;
}

export interface TourStopChange {
  column_index: number;
  added: Array<{ song_id: string; song_slug: string; song_title: string; position: number; section: TourSetlistSection }>;
  /** Only filled for complete setlists: a partial one can't prove a song was dropped. */
  dropped: Array<{ song_id: string; song_slug: string; song_title: string }>;
}

export interface TourMatrix {
  columns: TourMatrixColumn[];
  rows: TourMatrixRow[];
  stop_count: number;
  setlist_count: number;
  complete_count: number;
  /** Fixed / rotating counts need at least two complete setlists. */
  stats: { fixed: number; rotating: number; once: number } | null;
  /** Songs sung at more than half of the complete shows, in their usual order. */
  baseline: Array<{ song_id: string; song_slug: string; song_title: string }>;
  changes: TourStopChange[];
}

const SECTION_RANK: Record<TourSetlistSection, number> = { opening: 0, main: 1, other: 1, encore: 2, double_encore: 3 };

/** Day shows before night shows; code-point order would put 夜 before 昼. */
function showRank(label: string | null): number {
  if (!label) return 1;
  if (/昼|マチネ|第?[1一]部|day/i.test(label)) return 0;
  if (/夜|ソワレ|第?[2二]部|night/i.test(label)) return 2;
  return 1;
}

export function computeTourMatrix(shows: TourMatrixShowInput[], entries: TourMatrixEntryInput[]): TourMatrix {
  const ordered = [...shows].sort((a, b) =>
    a.start_date.localeCompare(b.start_date)
    || (a.start_time ?? "").localeCompare(b.start_time ?? "")
    || a.event_id.localeCompare(b.event_id)
    || showRank(a.performance_label) - showRank(b.performance_label)
    || (a.performance_label ?? "").localeCompare(b.performance_label ?? ""));

  const bySetlist = new Map<string, TourMatrixEntryInput[]>();
  for (const entry of entries) {
    const list = bySetlist.get(entry.setlist_id);
    if (list) list.push(entry);
    else bySetlist.set(entry.setlist_id, [entry]);
  }
  for (const list of bySetlist.values()) list.sort((a, b) => a.position - b.position);

  const stopNumbers = new Map<string, number>();
  const columns: TourMatrixColumn[] = ordered.map((show) => {
    if (!stopNumbers.has(show.event_id)) stopNumbers.set(show.event_id, stopNumbers.size + 1);
    return { ...show, stop_number: stopNumbers.get(show.event_id)!, entry_count: show.setlist_id ? bySetlist.get(show.setlist_id)?.length ?? 0 : 0 };
  });

  const complete = columns.map((column) => column.setlist_id !== null && column.completeness === "complete");
  const completeCount = complete.filter(Boolean).length;

  interface Acc { song_id: string; song_slug: string; song_title: string; cells: Map<number, TourCell>; sectionRank: number[]; relative: number[]; first: number }
  const songs = new Map<string, Acc>();
  columns.forEach((column, index) => {
    if (!column.setlist_id) return;
    const list = bySetlist.get(column.setlist_id) ?? [];
    list.forEach((entry, order) => {
      let acc = songs.get(entry.song_id);
      if (!acc) {
        acc = { song_id: entry.song_id, song_slug: entry.song_slug, song_title: entry.song_title, cells: new Map(), sectionRank: [], relative: [], first: index * 1000 + order };
        songs.set(entry.song_id, acc);
      }
      // A song played twice in one show (rare reprise) keeps its first slot.
      if (acc.cells.has(index)) return;
      acc.cells.set(index, { state: "sung", position: entry.position, section: entry.section });
      acc.sectionRank.push(SECTION_RANK[entry.section] ?? 1);
      acc.relative.push(list.length > 1 ? order / (list.length - 1) : 0);
    });
  });

  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

  const rows: TourMatrixRow[] = [...songs.values()]
    .map((acc) => ({ acc, sortSection: median(acc.sectionRank), sortPosition: mean(acc.relative) }))
    .sort((a, b) => a.sortSection - b.sortSection || a.sortPosition - b.sortPosition || a.acc.first - b.acc.first)
    .map(({ acc }) => {
      const cells: TourCell[] = columns.map((column, index) => acc.cells.get(index)
        ?? { state: !column.setlist_id ? "missing" : complete[index] ? "absent" : "unknown" });
      const sungComplete = complete.filter((isComplete, index) => isComplete && acc.cells.has(index)).length;
      const kind: TourSongKind | null = completeCount < 2 ? null
        : acc.cells.size === 1 ? "once"
          : sungComplete === completeCount ? "fixed" : "rotating";
      return {
        song_id: acc.song_id, song_slug: acc.song_slug, song_title: acc.song_title, cells,
        sung_count: acc.cells.size, kind, in_baseline: completeCount > 0 && sungComplete * 2 > completeCount,
      };
    });

  const stats = completeCount < 2 ? null : {
    fixed: rows.filter((row) => row.kind === "fixed").length,
    rotating: rows.filter((row) => row.kind === "rotating").length,
    once: rows.filter((row) => row.kind === "once").length,
  };

  const baselineRows = rows.filter((row) => row.in_baseline);
  const baselineIds = new Set(baselineRows.map((row) => row.song_id));
  const changes: TourStopChange[] = columns.flatMap((column, index) => {
    if (!column.setlist_id) return [];
    const added = rows.flatMap((row) => {
      const cell = row.cells[index];
      return cell.state === "sung" && !baselineIds.has(row.song_id)
        ? [{ song_id: row.song_id, song_slug: row.song_slug, song_title: row.song_title, position: cell.position, section: cell.section }]
        : [];
    }).sort((a, b) => a.position - b.position);
    const dropped = complete[index]
      ? baselineRows.filter((row) => row.cells[index].state === "absent").map(({ song_id, song_slug, song_title }) => ({ song_id, song_slug, song_title }))
      : [];
    return [{ column_index: index, added, dropped }];
  });

  return {
    columns,
    rows,
    stop_count: stopNumbers.size,
    setlist_count: columns.filter((column) => column.setlist_id).length,
    complete_count: completeCount,
    stats,
    baseline: baselineRows.map(({ song_id, song_slug, song_title }) => ({ song_id, song_slug, song_title })),
    changes,
  };
}
