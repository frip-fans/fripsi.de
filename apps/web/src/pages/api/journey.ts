import { listPublicJourneyStops } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { getEnv } from "../../lib/env";

export const GET: APIRoute = async () => {
  const stops = await listPublicJourneyStops(getEnv().DB);
  const dates = stops.map((stop) => stop.start_date);
  const countries = new Set(stops.map((stop) => stop.country_code).filter(Boolean));
  const venues = new Set(stops.map((stop) => stop.venue_id));
  const events = new Set(stops.map((stop) => stop.event_id));
  return Response.json({
    generated_at: new Date().toISOString(),
    range: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
    summary: {
      stops: stops.length,
      events: events.size,
      venues: venues.size,
      countries: countries.size,
      exact_stops: stops.filter((stop) => stop.coordinate_precision === "venue").length,
      approximate_stops: stops.filter((stop) => stop.coordinate_precision === "area").length,
    },
    stops,
  }, {
    headers: { "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" },
  });
};
