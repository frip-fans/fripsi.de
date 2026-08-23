export interface JourneyStop {
  event_id: string;
  slug: string;
  title: string;
  start_date: string;
  start_time: string | null;
  category: string;
  classification: string | null;
  status: string;
  venue_id: string;
  venue_name: string;
  area_name: string | null;
  country_code: string | null;
  latitude: number;
  longitude: number;
  coordinate_precision: "venue" | "area";
  position: number;
}

interface JourneyStopRow extends Omit<JourneyStop, "coordinate_precision"> {
  coordinate_precision: "venue" | "area";
}

export async function listPublicJourneyStops(db: D1Database): Promise<JourneyStop[]> {
  const result = await db.prepare(`
    SELECT e.id AS event_id, e.slug, e.title, e.start_date, e.start_time,
      e.category, e.classification, e.status,
      v.id AS venue_id, COALESCE(ev.display_name_snapshot, v.canonical_name) AS venue_name,
      a.name_local AS area_name, a.country_code,
      COALESCE(v.latitude, a.latitude) AS latitude,
      COALESCE(v.longitude, a.longitude) AS longitude,
      CASE WHEN v.latitude IS NOT NULL AND v.longitude IS NOT NULL THEN 'venue' ELSE 'area' END AS coordinate_precision,
      ev.position
    FROM events e
    JOIN event_venues ev ON ev.event_id = e.id
    JOIN venues v ON v.id = ev.venue_id
    LEFT JOIN administrative_areas a ON a.id = v.administrative_area_id
    WHERE e.published = 1 AND e.archived_at IS NULL
      AND e.location_mode IN ('physical', 'multiple', 'hybrid')
      AND COALESCE(v.latitude, a.latitude) IS NOT NULL
      AND COALESCE(v.longitude, a.longitude) IS NOT NULL
    ORDER BY e.start_date ASC, e.start_time ASC, ev.position ASC, e.id ASC
  `).all<JourneyStopRow>();
  return result.results.map((row) => ({
    ...row,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  }));
}
