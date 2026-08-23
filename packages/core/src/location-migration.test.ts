/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

function migration(name: string): string {
  return readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), "utf8");
}

describe("structured location migration", () => {
  it("moves physical and online legacy locations without foreign-key errors", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(migration("0001_initial.sql"));
    db.exec(migration("0002_import_jobs.sql"));
    db.exec(migration("0003_music_library.sql"));
    db.exec(`INSERT INTO events (
      id, slug, title, start_date, timezone, category, venue, region, status,
      published, version, created_at, updated_at
    ) VALUES
      ('evt_physical', 'physical', 'Physical', '2026-01-01', 'Asia/Tokyo', 'LIVE',
       '新宿LOFT', '東京都新宿区', 'scheduled', 1, 1, '2026-01-01', '2026-01-01'),
      ('evt_online', 'online', 'Online', '2026-01-02', 'Asia/Tokyo', 'MEDIA',
       'YouTube', '在线', 'scheduled', 1, 1, '2026-01-01', '2026-01-01')`);

    db.exec(migration("0004_structured_locations.sql"));
    db.exec(migration("0005_journey_coordinates.sql"));
    db.exec(migration("0006_journey_coordinate_data.sql"));

    expect(db.prepare("SELECT location_mode FROM events WHERE id = ?").get("evt_physical"))
      .toMatchObject({ location_mode: "physical" });
    expect(db.prepare("SELECT location_mode FROM events WHERE id = ?").get("evt_online"))
      .toMatchObject({ location_mode: "online" });
    expect(db.prepare(`SELECT v.canonical_name, a.name_local, c.code
      FROM event_venues ev JOIN venues v ON v.id = ev.venue_id
      JOIN administrative_areas a ON a.id = v.administrative_area_id
      JOIN administrative_area_codes c ON c.administrative_area_id = a.id AND c.scheme = 'JP_STANDARD_AREA'
      WHERE ev.event_id = ?`).get("evt_physical"))
      .toMatchObject({ canonical_name: "新宿LOFT", name_local: "新宿区", code: "13104" });
    expect(db.prepare("SELECT channel_type, name FROM event_channels WHERE event_id = ?").get("evt_online"))
      .toMatchObject({ channel_type: "streaming", name: "YouTube" });
    expect(db.prepare("PRAGMA table_info(events)").all().map((column: Record<string, unknown>) => column.name))
      .not.toContain("venue");
    expect(db.prepare("PRAGMA table_info(administrative_areas)").all().map((column: Record<string, unknown>) => column.name))
      .toContain("latitude");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });
});
