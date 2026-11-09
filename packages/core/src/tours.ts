import { eventDisplayTitleSql } from "./event-display";

export interface TourRecord {
  id: string;
  slug: string;
  name: string;
  notes: string | null;
  published: boolean;
  created_at: string;
  updated_at: string;
  stop_count: number;
  first_date: string | null;
  last_date: string | null;
}

export interface TourStop {
  event_id: string;
  event_slug: string;
  event_title: string;
  display_title: string;
  start_date: string;
  tour_stop: string | null;
  published: boolean;
  setlist_id: string | null;
}

export interface TourDetail extends TourRecord {
  stops: TourStop[];
}

type TourRow = Omit<TourRecord, "published"> & { published: number };

const tourSelect = (publicOnly: boolean) => `
  SELECT t.id, t.slug, t.name, t.notes, t.published, t.created_at, t.updated_at,
    COUNT(e.id) AS stop_count, MIN(e.start_date) AS first_date, MAX(e.start_date) AS last_date
  FROM tours t
  LEFT JOIN events e ON e.tour_id = t.id AND e.archived_at IS NULL${publicOnly ? " AND e.published = 1" : ""}
`;

function mapTour(row: TourRow): TourRecord {
  return { ...row, published: row.published === 1 };
}

export async function listTours(db: D1Database, options: { publicOnly?: boolean } = {}): Promise<TourRecord[]> {
  const result = await db.prepare(`${tourSelect(Boolean(options.publicOnly))}
    ${options.publicOnly ? "WHERE t.published = 1" : ""}
    GROUP BY t.id ORDER BY first_date IS NULL, first_date DESC, t.name COLLATE NOCASE`).all<TourRow>();
  return result.results.map(mapTour);
}

async function tourStops(db: D1Database, tourId: string, publicOnly: boolean): Promise<TourStop[]> {
  const result = await db.prepare(`SELECT e.id AS event_id, e.slug AS event_slug, e.title AS event_title,
      ${eventDisplayTitleSql("e")} AS display_title, e.start_date, e.tour_stop, e.published,
      (SELECT sl.id FROM setlists sl WHERE sl.event_id = e.id AND sl.published = 1 ORDER BY sl.performance_label LIMIT 1) AS setlist_id
    FROM events e
    WHERE e.tour_id = ? AND e.archived_at IS NULL${publicOnly ? " AND e.published = 1" : ""}
    ORDER BY e.start_date, COALESCE(e.start_time, ''), e.id`).bind(tourId).all<Omit<TourStop, "published"> & { published: number }>();
  return result.results.map((row) => ({ ...row, published: row.published === 1 }));
}

export async function getTourById(db: D1Database, id: string): Promise<TourDetail | null> {
  const row = await db.prepare(`${tourSelect(false)} WHERE t.id = ? GROUP BY t.id`).bind(id).first<TourRow>();
  if (!row) return null;
  return { ...mapTour(row), stops: await tourStops(db, row.id, false) };
}

export async function getPublicTourBySlug(db: D1Database, slug: string): Promise<TourDetail | null> {
  const row = await db.prepare(`${tourSelect(true)} WHERE t.slug = ? AND t.published = 1 GROUP BY t.id`).bind(slug).first<TourRow>();
  if (!row) return null;
  return { ...mapTour(row), stops: await tourStops(db, row.id, true) };
}
