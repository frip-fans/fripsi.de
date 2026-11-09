/** A past event that falls on today's calendar day, for the homepage hero. */
export interface OnThisDayRow {
  slug: string;
  title: string;
  start_date: string;
  category: string;
  /** The published setlist for the show, when the archive has one. */
  setlist_id: string | null;
}

export interface OnThisDay {
  event: OnThisDayRow;
  years_ago: number;
  /** How many past events share this calendar day. */
  total: number;
}

/**
 * The one worth showing: a show with a setlist beats a show without one, a live beats a broadcast
 * or a release date, and the most recent year breaks the remaining ties.
 */
export function pickOnThisDay(rows: readonly OnThisDayRow[], today: string): OnThisDay | null {
  const score = (row: OnThisDayRow) => (row.setlist_id ? 2 : 0) + (row.category === "LIVE" ? 1 : 0);
  const best = [...rows].sort((a, b) => score(b) - score(a) || b.start_date.localeCompare(a.start_date))[0];
  if (!best) return null;
  return { event: best, years_ago: Number(today.slice(0, 4)) - Number(best.start_date.slice(0, 4)), total: rows.length };
}

/** Past events on the same month and day as `today` (`YYYY-MM-DD`). */
export async function getOnThisDay(db: D1Database, today: string): Promise<OnThisDay | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const result = await db.prepare(`
    SELECT e.slug, e.title, e.start_date, e.category,
      (SELECT sl.id FROM setlists sl WHERE sl.event_id = e.id AND sl.published = 1
        ORDER BY sl.performance_label ASC LIMIT 1) AS setlist_id
    FROM events e
    WHERE e.published = 1 AND e.archived_at IS NULL
      AND substr(e.start_date, 6, 5) = ? AND e.start_date < ?
  `).bind(today.slice(5), today).all<OnThisDayRow>();
  return pickOnThisDay(result.results, today);
}
