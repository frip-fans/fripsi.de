/**
 * Event display names. An event shows, in order of preference:
 *   1. its alias, set in the admin (initialised from setlist titles);
 *   2. "<tour name> · <stop>", where the stop is tour_stop or "<area>公演";
 *   3. its official title.
 * Official titles stay intact elsewhere (detail pages show them in small type, feeds and structured data use them).
 * The SQL expression is the single implementation, so every query that lists events agrees on the name.
 */

/** First venue area of an event, with the Japanese prefecture suffix removed (東京都 → 東京, 北海道 kept). */
export function eventStopAreaSql(eventAlias = "e"): string {
  return `(SELECT CASE
      WHEN a.country_code = 'JP' AND a.name_local <> '北海道' AND substr(a.name_local, -1) IN ('都', '府', '県')
        THEN substr(a.name_local, 1, length(a.name_local) - 1)
      ELSE a.name_local END
    FROM event_venues ev
    JOIN venues v ON v.id = ev.venue_id
    JOIN administrative_areas a ON a.id = v.administrative_area_id
    WHERE ev.event_id = ${eventAlias}.id
    ORDER BY ev.position LIMIT 1)`;
}

/** "<tour name> · <stop>" for an event in a published tour, or NULL when the tour or stop is unknown. */
export function eventTourStopSql(eventAlias = "e"): string {
  return `(SELECT t.name || ' · ' || COALESCE(NULLIF(TRIM(${eventAlias}.tour_stop), ''), ${eventStopAreaSql(eventAlias)} || '公演')
    FROM tours t WHERE t.id = ${eventAlias}.tour_id AND t.published = 1)`;
}

export function eventDisplayTitleSql(eventAlias = "e"): string {
  return `COALESCE(NULLIF(TRIM(${eventAlias}.alias), ''), ${eventTourStopSql(eventAlias)}, ${eventAlias}.title)`;
}

/** Same rule as the SQL, for records already loaded (e.g. tests and admin previews). */
export function eventDisplayTitle(event: { title: string; alias?: string | null; tour_name?: string | null; tour_stop?: string | null; stop_area?: string | null }): string {
  const alias = event.alias?.trim();
  if (alias) return alias;
  const stop = event.tour_stop?.trim() || (event.stop_area ? `${event.stop_area}公演` : "");
  if (event.tour_name && stop) return `${event.tour_name} · ${stop}`;
  return event.title;
}
