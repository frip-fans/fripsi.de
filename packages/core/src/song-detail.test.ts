/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { countPublicSetlistsSince, getAdjacentSetlists, getSongBySlug, songPerformancePagination } from "./music-repository";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of ["0001_initial.sql", "0002_import_jobs.sql", "0003_music_library.sql", "0004_structured_locations.sql", "0005_journey_coordinates.sql", "0006_journey_coordinate_data.sql", "0007_release_covers.sql", "0014_music_external_ids.sql", "0016_event_alias_tours.sql"]) {
    sqlite.exec(readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  }
  sqlite.exec(`INSERT INTO songs (id,slug,title,normalized_title,created_at,updated_at) VALUES ('song','test-song','Test song','test song','now','now');
    INSERT INTO song_versions (id,song_id,slug,title,created_at,updated_at) VALUES ('version','song','test-version','Test version','now','now');`);
  for (const [id, cover, published] of [["cover", `/media/covers/${"a".repeat(64)}.jpg`, 1], ["missing", null, 1], ["hidden", null, 0]] as const) {
    sqlite.prepare("INSERT INTO releases (id,slug,title,release_type,cover_url,published,created_at,updated_at) VALUES (?,?,?,'album',?,?,'now','now')").run(id, id, id, cover, published);
    sqlite.prepare("INSERT INTO release_tracks (id,release_id,song_version_id,track_number,display_title,created_at) VALUES (?,?,'version',1,'Test song','now')").run(id, id);
  }
  for (let i = 0; i < 47; i++) {
    const id = String(i).padStart(2, "0");
    sqlite.prepare("INSERT INTO events (id,slug,title,start_date,timezone,category,status,published,archived_at,created_at,updated_at) VALUES (?,?,?,'2026-09-01','Asia/Tokyo','LIVE','completed',?,?,'now','now')").run(id, `event-${id}`, `Event ${id}`, i === 43 ? 0 : 1, i === 45 ? "now" : null);
    sqlite.prepare("INSERT INTO setlists (id,event_id,performance_label,published,created_at,updated_at) VALUES (?,?,'Live',?,'now','now')").run(id, id, i === 44 ? 0 : 1);
    sqlite.prepare("INSERT INTO setlist_entries (id,setlist_id,position,song_id,display_title,created_at) VALUES (?,?,1,'song','Test song','now')").run(id, id);
  }
  sqlite.exec("INSERT INTO setlist_entries (id,setlist_id,position,song_id,display_title,created_at) VALUES ('repeat','00',2,'song','Encore repeat','now')");
  const db = { prepare(sql: string) {
    const statement = sqlite.prepare(sql);
    let args: SQLInputValue[] = [];
    const query = {
      bind(...values: SQLInputValue[]) { args = values; return query; },
      async first() { return statement.get(...args) ?? null; },
      async all() { return { results: statement.all(...args), success: true }; },
    };
    return query;
  } } as unknown as D1Database;
  return { sqlite, db };
}

describe("song detail pagination and covers", () => {
  it("counts public setlists since a date for the performance rate", async () => {
    const { sqlite, db } = fixture();
    try {
      // 47 setlists: one with an unpublished event, one unpublished setlist and one archived event are excluded.
      expect(await countPublicSetlistsSince(db, "2026-01-01")).toBe(44);
      expect(await countPublicSetlistsSince(db, "2026-09-02")).toBe(0);
      expect(await countPublicSetlistsSince(db, "not-a-date")).toBe(0);
    } finally { sqlite.close(); }
  });
  it("pages public performances without duplicates or omissions while preserving totals and release covers", async () => {
    const { sqlite, db } = fixture();
    try {
      const pages = await Promise.all([1, 2, 3, 4, 5].map((page) => getSongBySlug(db, "test-song", page)));
      expect(pages.map((song) => song?.performances.length)).toEqual([10, 10, 10, 10, 5]);
      for (const song of pages) {
        expect(song?.performance_count).toBe(45);
        expect(song?.show_count).toBe(44);
        expect(song?.releases).toHaveLength(2);
        expect(song?.releases.find((release) => release.release_id === "cover")?.cover_url).toBe(`/media/covers/${"a".repeat(64)}.jpg`);
        expect(song?.releases.find((release) => release.release_id === "missing")?.cover_url).toBeNull();
      }
      const entries = pages.flatMap((song) => song!.performances.map((item) => `${item.setlist_id}:${item.position}`));
      expect(new Set(entries).size).toBe(45);
      expect(entries).not.toContain("43:1");
      expect(entries).not.toContain("44:1");
      expect(entries).not.toContain("45:1");
      expect((await getSongBySlug(db, "test-song"))?.performances).toHaveLength(45);
      expect((await getSongBySlug(db, "test-song", 999))?.performances).toEqual(pages[4]?.performances);
      expect((await getSongBySlug(db, "test-song", NaN))?.performances).toEqual(pages[0]?.performances);
      expect(await getSongBySlug(db, "not-found", 1)).toBeNull();
    } finally { sqlite.close(); }
  });
  it("sorts dates and same-day times across page boundaries in both directions", async () => {
    const { sqlite, db } = fixture();
    try {
      sqlite.exec("UPDATE events SET start_date = '2026-09-02', start_time = '18:00' WHERE id = '00'; UPDATE events SET start_date = '2026-09-02', start_time = '20:00' WHERE id = '01'; UPDATE events SET start_date = '2026-08-01' WHERE id = '02'");
      const asc = (await Promise.all([1, 2, 3, 4, 5].map(page => getSongBySlug(db, "test-song", page, "asc")))).flatMap(song => song!.performances);
      const desc = (await Promise.all([1, 2, 3, 4, 5].map(page => getSongBySlug(db, "test-song", page, "desc")))).flatMap(song => song!.performances);
      expect(asc[0].setlist_id).toBe("02");
      expect(asc.at(-1)?.setlist_id).toBe("01");
      expect(desc[0].setlist_id).toBe("01");
      expect(desc.at(-1)?.setlist_id).toBe("02");
      const identity = (items: typeof asc) => items.map(item => `${item.setlist_id}:${item.position}`).sort();
      expect(identity(asc)).toEqual(identity(desc));
      expect(new Set(identity(asc)).size).toBe(45);
    } finally { sqlite.close(); }
  });
  it("handles empty, single-page, invalid and fractional page requests", () => {
    expect(songPerformancePagination(0, 999)).toMatchObject({ page: 1, totalPages: 1, offset: 0 });
    expect(songPerformancePagination(10, 2)).toMatchObject({ page: 1, totalPages: 1 });
    expect(songPerformancePagination(45, -1)).toMatchObject({ page: 1, offset: 0 });
    expect(songPerformancePagination(45, Infinity)).toMatchObject({ page: 1 });
    expect(songPerformancePagination(45, 2.7)).toMatchObject({ page: 2, offset: 10 });
  });
});

describe("adjacent setlists", () => {
  it("steps through public setlists in list order and stops at both ends", async () => {
    const { sqlite, db } = fixture();
    try {
      // Spread a few events over dates; same-day shows fall back to the label and id.
      sqlite.exec("UPDATE events SET start_date = '2026-08-01' WHERE id = '00'; UPDATE events SET start_date = '2026-10-01' WHERE id = '46'; UPDATE setlists SET performance_label = 'Day' WHERE id = '02'");
      const at = (id: string) => sqlite.prepare("SELECT sl.id, e.start_date, e.start_time, sl.performance_label FROM setlists sl JOIN events e ON e.id = sl.event_id WHERE sl.id = ?").get(id) as { id: string; start_date: string; start_time: string | null; performance_label: string };
      const first = await getAdjacentSetlists(db, at("00"));
      expect(first.previous).toBeNull();
      expect(first.next?.id).toBe("02");
      const middle = await getAdjacentSetlists(db, at("02"));
      expect([middle.previous?.id, middle.next?.id]).toEqual(["00", "01"]);
      // 43 (unpublished event), 44 (unpublished setlist) and 45 (archived) are skipped.
      expect((await getAdjacentSetlists(db, at("42"))).next?.id).toBe("46");
      expect((await getAdjacentSetlists(db, at("46"))).next).toBeNull();
    } finally { sqlite.close(); }
  });
});
