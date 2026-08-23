import { describe, expect, it } from "vitest";
import { listPublicJourneyStops } from "./journey";

describe("Live Journey repository", () => {
  it("uses venue coordinates with administrative-area fallback and returns numbers", async () => {
    let capturedSql = "";
    const db = {
      prepare(sql: string) {
        capturedSql = sql;
        return {
          async all() {
            return { results: [{
              event_id: "event-1", slug: "event", title: "Event", start_date: "2026-01-01",
              start_time: null, category: "LIVE", classification: "专场", status: "completed",
              venue_id: "venue-1", venue_name: "Venue", area_name: "東京都", country_code: "JP",
              latitude: "35.6", longitude: "139.7", coordinate_precision: "area", position: 1,
            }] };
          },
        };
      },
    } as unknown as D1Database;

    const stops = await listPublicJourneyStops(db);
    expect(capturedSql).toContain("COALESCE(v.latitude, a.latitude)");
    expect(stops[0]).toMatchObject({ latitude: 35.6, longitude: 139.7, coordinate_precision: "area" });
  });
});
