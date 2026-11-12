import { eventDisplayTitleSql, eventStopAreaSql } from "./event-display";
import { dateInTimeZone } from "./utils";
import { computeTourMatrix, type TourMatrix, type TourMatrixEntryInput, type TourMatrixShowInput } from "./tour-matrix";

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
  /** Stops with at least one published setlist. */
  setlist_stop_count: number;
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
    COUNT(e.id) AS stop_count, MIN(e.start_date) AS first_date, MAX(e.start_date) AS last_date,
    COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM setlists sl WHERE sl.event_id = e.id AND sl.published = 1) THEN e.id END) AS setlist_stop_count
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

/** An event the admin can add to a tour: every live (non-archived) event outside it, newest first. */
export interface TourCandidateEvent {
  id: string;
  title: string;
  display_title: string;
  start_date: string;
  category: string;
  published: boolean;
  venue_name: string | null;
  area_name: string | null;
  tour_id: string | null;
  tour_name: string | null;
}

export async function listTourCandidateEvents(db: D1Database, tourId: string): Promise<TourCandidateEvent[]> {
  const result = await db.prepare(`SELECT e.id, e.title, ${eventDisplayTitleSql("e")} AS display_title, e.start_date, e.category, e.published,
      (SELECT v.canonical_name FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
        WHERE ev.event_id = e.id ORDER BY ev.position LIMIT 1) AS venue_name,
      ${eventStopAreaSql("e")} AS area_name,
      e.tour_id, t.name AS tour_name
    FROM events e
    LEFT JOIN tours t ON t.id = e.tour_id
    WHERE e.archived_at IS NULL AND (e.tour_id IS NULL OR e.tour_id <> ?)
    ORDER BY e.start_date DESC, COALESCE(e.start_time, '') DESC, e.id`).bind(tourId).all<Omit<TourCandidateEvent, "published"> & { published: number }>();
  return result.results.map((row) => ({ ...row, published: row.published === 1 }));
}

/** Public tour page: the tour, its stops and the song-by-show matrix. */
export interface PublicTourPage extends TourRecord {
  matrix: TourMatrix;
}

export async function getPublicTourPage(db: D1Database, slug: string, today = dateInTimeZone()): Promise<PublicTourPage | null> {
  const row = await db.prepare(`${tourSelect(true)} WHERE t.slug = ? AND t.published = 1 GROUP BY t.id`).bind(slug).first<TourRow>();
  if (!row) return null;
  const visible = "e.tour_id = ? AND e.published = 1 AND e.archived_at IS NULL";
  const [shows, entries] = await Promise.all([
    db.prepare(`SELECT e.id AS event_id, e.slug AS event_slug, e.start_date, e.start_time,
        COALESCE(NULLIF(TRIM(e.tour_stop), ''), ${eventStopAreaSql("e")} || '公演', NULLIF(TRIM(e.alias), ''), e.title) AS stop_label,
        sl.id AS setlist_id, sl.performance_label, sl.completeness
      FROM events e
      LEFT JOIN setlists sl ON sl.event_id = e.id AND sl.published = 1
      WHERE ${visible}`).bind(row.id).all<TourMatrixShowInput>(),
    db.prepare(`SELECT se.setlist_id, s.id AS song_id, s.slug AS song_slug, s.title AS song_title, se.position, se.section
      FROM setlist_entries se
      JOIN setlists sl ON sl.id = se.setlist_id AND sl.published = 1
      JOIN events e ON e.id = sl.event_id
      JOIN songs s ON s.id = se.song_id AND s.published = 1
      WHERE ${visible}`).bind(row.id).all<TourMatrixEntryInput>(),
  ]);
  return { ...mapTour(row), matrix: computeTourMatrix(shows.results, entries.results, today) };
}

/** Where an event sits in its (published) tour, for "XX tour · stop 3/8" links and stop-to-stop navigation. */
export interface EventTourContext {
  slug: string;
  name: string;
  stop_number: number;
  stop_count: number;
  previous: { slug: string; title: string; start_date: string } | null;
  next: { slug: string; title: string; start_date: string } | null;
}

export async function getEventTourContext(db: D1Database, eventId: string): Promise<EventTourContext | null> {
  const tour = await db.prepare(`SELECT t.id, t.slug, t.name FROM events e JOIN tours t ON t.id = e.tour_id AND t.published = 1
    WHERE e.id = ? AND e.published = 1 AND e.archived_at IS NULL`).bind(eventId).first<{ id: string; slug: string; name: string }>();
  if (!tour) return null;
  const stops = await db.prepare(`SELECT e.id, e.slug, ${eventDisplayTitleSql("e")} AS title, e.start_date
    FROM events e WHERE e.tour_id = ? AND e.published = 1 AND e.archived_at IS NULL
    ORDER BY e.start_date, COALESCE(e.start_time, ''), e.id`).bind(tour.id).all<{ id: string; slug: string; title: string; start_date: string }>();
  const index = stops.results.findIndex((stop) => stop.id === eventId);
  if (index < 0) return null;
  const pick = (stop: (typeof stops.results)[number] | undefined) => stop ? { slug: stop.slug, title: stop.title, start_date: stop.start_date } : null;
  return { slug: tour.slug, name: tour.name, stop_number: index + 1, stop_count: stops.results.length, previous: pick(stops.results[index - 1]), next: pick(stops.results[index + 1]) };
}
