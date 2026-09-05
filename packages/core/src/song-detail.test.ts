/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { getSongBySlug, songPerformancePagination } from "./music-repository";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of ["0001_initial.sql", "0002_import_jobs.sql", "0003_music_library.sql", "0004_structured_locations.sql", "0005_journey_coordinates.sql", "0006_journey_coordinate_data.sql", "0007_release_covers.sql"]) {
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
  it("pages public performances without duplicates or omissions while preserving totals and release covers", async () => {
    const { sqlite, db } = fixture();
    try {
      const pages = await Promise.all([1, 2, 3].map((page) => getSongBySlug(db, "test-song", page)));
      expect(pages.map((song) => song?.performances.length)).toEqual([20, 20, 5]);
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
      expect((await getSongBySlug(db, "test-song", 999))?.performances).toEqual(pages[2]?.performances);
      expect((await getSongBySlug(db, "test-song", NaN))?.performances).toEqual(pages[0]?.performances);
      expect(await getSongBySlug(db, "not-found", 1)).toBeNull();
    } finally { sqlite.close(); }
  });
  it("handles empty, single-page, invalid and fractional page requests", () => {
    expect(songPerformancePagination(0, 999)).toMatchObject({ page: 1, totalPages: 1, offset: 0 });
    expect(songPerformancePagination(20, 2)).toMatchObject({ page: 1, totalPages: 1 });
    expect(songPerformancePagination(45, -1)).toMatchObject({ page: 1, offset: 0 });
    expect(songPerformancePagination(45, Infinity)).toMatchObject({ page: 1 });
    expect(songPerformancePagination(45, 2.7)).toMatchObject({ page: 2, offset: 20 });
  });
});
