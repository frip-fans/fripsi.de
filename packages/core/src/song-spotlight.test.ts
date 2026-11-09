/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { getSongSpotlight, pickSpotlightIndex } from "./song-spotlight";
import { createTestD1 } from "./test-d1";

function fixture() {
  const { db, sqlite } = createTestD1();
  const event = (id: string, date: string, published = 1, archived: string | null = null) =>
    sqlite.prepare("INSERT INTO events (id,slug,title,start_date,timezone,category,status,published,archived_at,created_at,updated_at) VALUES (?,?,?,?,'Asia/Tokyo','LIVE','completed',?,?,'now','now')")
      .run(id, `event-${id}`, `Event ${id}`, date, published, archived);
  const setlist = (id: string, eventId: string, published = 1) =>
    sqlite.prepare("INSERT INTO setlists (id,event_id,performance_label,title,published,created_at,updated_at) VALUES (?,?,'Day 1',?,?,'now','now')")
      .run(id, eventId, `Setlist ${id}`, published);
  const entry = (id: string, setlistId: string, songId: string, position: number) =>
    sqlite.prepare("INSERT INTO setlist_entries (id,setlist_id,position,song_id,display_title,created_at) VALUES (?,?,?,?,'Song','now')")
      .run(id, setlistId, position, songId);

  sqlite.exec(`
    INSERT INTO songs (id,slug,title,normalized_title,original_artist,first_release_date,published,created_at,updated_at) VALUES
      ('sung','sung-song','Sung song','sung song','fripSide','2010-01-01',1,'now','now'),
      ('rested','rested-song','Rested song','rested song','fripSide','2010-01-01',1,'now','now'),
      ('never','never-song','Never performed','never performed','fripSide','2010-01-01',1,'now','now'),
      ('hidden','hidden-song','Hidden song','hidden song','fripSide','2010-01-01',0,'now','now');
    INSERT INTO song_versions (id,song_id,slug,title,published,created_at,updated_at) VALUES ('sung-v','sung','sung-version','Sung version',1,'now','now');
    INSERT INTO releases (id,slug,title,release_type,published,created_at,updated_at) VALUES ('rel','rel','Release','single',1,'now','now');
    INSERT INTO release_tracks (id,release_id,song_version_id,track_number,display_title,created_at) VALUES ('track','rel','sung-v',1,'Sung song','now');
  `);
  // Four archived shows plus three that must never count: an unpublished event, an unpublished
  // setlist and an archived event.
  event("e1", "2010-05-01");
  event("e2", "2012-07-01");
  event("e3", "2013-08-01");
  event("e4", "2014-09-01");
  event("e5", "2015-10-01", 0);
  event("e6", "2015-11-01", 1, "now");
  event("e7", "2015-12-01");
  for (const [id, eventId] of [["s1", "e1"], ["s2", "e2"], ["s3", "e3"], ["s4", "e4"], ["s5", "e5"], ["s6", "e6"]] as const) setlist(id, eventId);
  setlist("s7", "e7", 0);
  entry("x1", "s1", "sung", 1);
  // Same song twice in one show (a medley reprise) counts as one show.
  entry("x2", "s1", "sung", 2);
  entry("x3", "s3", "sung", 1);
  entry("x4", "s1", "rested", 3);
  entry("x5", "s5", "sung", 1);
  entry("x6", "s6", "sung", 1);
  entry("x7", "s7", "sung", 1);
  entry("x8", "s2", "hidden", 1);
  return { db, sqlite };
}

describe("song spotlight", () => {
  it("picks the same index for a seed and stays inside the candidate list", () => {
    expect(pickSpotlightIndex("2026-11-09", 10)).toBe(pickSpotlightIndex("2026-11-09", 10));
    expect(pickSpotlightIndex("2026-11-09", 0)).toBe(0);
    const picks = new Set(Array.from({ length: 60 }, (_, day) => pickSpotlightIndex(`2026-01-${day}`, 7)));
    for (const index of picks) expect(index).toBeGreaterThanOrEqual(0);
    for (const index of picks) expect(index).toBeLessThan(7);
    // A month of seeds must not collapse onto one song.
    expect(picks.size).toBeGreaterThan(1);
  });

  it("reports shows, boundaries, rate denominator and yearly counts for the picked song", async () => {
    const { db, sqlite } = fixture();
    try {
      // Leave one candidate so the pick is fixed whatever the seed hashes to.
      sqlite.exec("DELETE FROM setlist_entries WHERE song_id = 'rested'");
      const target = (await getSongSpotlight(db, "2026-11-09"))!;
      expect(target.slug).toBe("sung-song");
      expect(target).toMatchObject({
        title: "Sung song",
        release_count: 1,
        show_count: 2,
        shows_since_release: 4,
        shows_since_last: 1,
      });
      expect(target.first_performance).toMatchObject({ setlist_id: "s1", start_date: "2010-05-01", title: "Setlist s1" });
      expect(target.last_performance).toMatchObject({ setlist_id: "s3", start_date: "2013-08-01" });
      expect(target.years).toEqual([
        { year: "2010", total: 1, sung: 1 },
        { year: "2012", total: 1, sung: 0 },
        { year: "2013", total: 1, sung: 1 },
        { year: "2014", total: 1, sung: 0 },
      ]);
    } finally { sqlite.close(); }
  });

  it("only ever picks published songs that have an archived performance", async () => {
    const { db, sqlite } = fixture();
    try {
      const picked = new Set<string>();
      for (let day = 1; day <= 40; day += 1) {
        const spotlight = await getSongSpotlight(db, `2026-03-${day}`);
        picked.add(spotlight!.slug);
      }
      expect([...picked].sort()).toEqual(["rested-song", "sung-song"]);
    } finally { sqlite.close(); }
  });

  it("returns nothing when no published song has been performed", async () => {
    const { db, sqlite } = createTestD1();
    try {
      sqlite.exec("INSERT INTO songs (id,slug,title,normalized_title,published,created_at,updated_at) VALUES ('a','a','A','a',1,'now','now')");
      expect(await getSongSpotlight(db, "2026-11-09")).toBeNull();
    } finally { sqlite.close(); }
  });
});
