import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { getMusicBrowseResults, MUSIC_BATCH_SIZE, MUSIC_SONG_BATCH_SIZE, MUSIC_WIDE_RELEASE_BATCH_SIZE, parseMusicBrowse } from "./music-browse";

const FIXTURE_SIZE = MUSIC_BATCH_SIZE + 2;

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../../../../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
  for (let i = 0; i < FIXTURE_SIZE; i++) {
    const id = String(i).padStart(2, "0");
    sqlite.prepare("INSERT INTO songs(id,slug,title,normalized_title,created_at,updated_at) VALUES(?,?,?,?, 'now','now')").run(id, `song-${id}`, `Song ${id}`, `song ${id}`);
    sqlite.prepare("INSERT INTO releases(id,slug,title,release_type,release_date,created_at,updated_at) VALUES(?,?,?,? ,?,'now','now')").run(id, `release-${id}`, `Release ${id}`, i % 2 ? "album" : "single", `2026-01-${id === "00" ? "01" : id}`);
    sqlite.prepare("INSERT INTO events(id,slug,title,start_date,timezone,category,classification,status,published,created_at,updated_at) VALUES(?,?,?,?,'Asia/Tokyo','LIVE',?,'completed',1,'now','now')").run(id, `event-${id}`, `Live ${id}`, i < 3 ? "2026-01-01" : "2025-01-01", i % 2 ? "专场" : "拼盘");
    sqlite.prepare("INSERT INTO setlists(id,event_id,performance_label,created_at,updated_at) VALUES(?,?,'Live','now','now')").run(id,id);
    sqlite.prepare("INSERT INTO setlist_entries(id,setlist_id,position,song_id,display_title,created_at) VALUES(?,?,1,'00','black bullet','now')").run(id,id);
  }
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

describe("shared music browsing", () => {
  it("defaults to all years and normalizes invalid filters, sort and page values", () => {
    expect(parseMusicBrowse("lives", new URLSearchParams())).toMatchObject({ years: [], classifications: [], page: 1, sort: "desc" });
    expect(parseMusicBrowse("lives", new URLSearchParams("year=all&classification=bad&sort=bad&page=-2")))
      .toMatchObject({ years: [], classifications: [], sort: "desc", page: 1 });
    expect(parseMusicBrowse("releases", new URLSearchParams("type=constructor&page=999999"))).toMatchObject({ types: [], page: 80 });
    expect(parseMusicBrowse("lives", new URLSearchParams("year=2026&year=bad&year=2025&year=2026&classification=专场&classification=x")))
      .toMatchObject({ years: ["2026", "2025"], classifications: ["专场"] });
    expect(parseMusicBrowse("releases", new URLSearchParams("type=album&type=single&type=nope")).types).toEqual(["album", "single"]);
    expect(parseMusicBrowse("songs", new URLSearchParams("year=2026&type=album"))).toMatchObject({ years: [], types: [] });
    expect(parseMusicBrowse("songs", new URLSearchParams({ q: "x".repeat(300) })).query).toHaveLength(200);
    expect(parseMusicBrowse("songs", new URLSearchParams("phase=3&phase=4&phase=1&phase=3")).phases).toEqual(["3", "1"]);
    expect(parseMusicBrowse("lives", new URLSearchParams("phase=1")).phases).toEqual([]);
  });
  it("returns one batch initially, appends the next batch, and restores loaded items on the live and release pages", async () => {
    const { sqlite, db } = fixture();
    try {
      for (const kind of ["lives", "releases"] as const) {
        const first = await getMusicBrowseResults(db, kind, new URLSearchParams());
        const next = await getMusicBrowseResults(db, kind, new URLSearchParams("page=2"), true);
        const restored = await getMusicBrowseResults(db, kind, new URLSearchParams("page=2"));
        expect(first[kind]).toHaveLength(MUSIC_BATCH_SIZE);
        expect(first).toMatchObject({ total: FIXTURE_SIZE, shown: MUSIC_BATCH_SIZE, hasMore: true });
        expect(next[kind]).toHaveLength(FIXTURE_SIZE - MUSIC_BATCH_SIZE);
        expect(next).toMatchObject({ shown: FIXTURE_SIZE, hasMore: false });
        expect(restored[kind].map(item => item.id)).toEqual([...first[kind], ...next[kind]].map(item => item.id));
        expect(new Set(restored[kind].map(item => item.id)).size).toBe(FIXTURE_SIZE);
        if (kind === "releases") {
          const desktop = await getMusicBrowseResults(db, kind, new URLSearchParams(`batch=${MUSIC_WIDE_RELEASE_BATCH_SIZE}`));
          expect(desktop.releases).toHaveLength(FIXTURE_SIZE);
          expect(desktop).toMatchObject({ batch: MUSIC_WIDE_RELEASE_BATCH_SIZE, shown: FIXTURE_SIZE, hasMore: false });
          expect(parseMusicBrowse(kind, new URLSearchParams("batch=999")).batch).toBe(MUSIC_BATCH_SIZE);
        }
      }
    } finally { sqlite.close(); }
  });
  it("combines multiple years and classifications with OR inside a group and AND across groups", async () => {
    const { sqlite, db } = fixture();
    try {
      const both = await getMusicBrowseResults(db, "lives", new URLSearchParams("year=2026&year=2025"));
      expect(both.total).toBe(FIXTURE_SIZE);
      expect(both.yearCounts).toEqual({ "2026": 3, "2025": FIXTURE_SIZE - 3 });
      expect((await getMusicBrowseResults(db, "lives", new URLSearchParams("year=2026&classification=专场&classification=拼盘"))).total).toBe(3);
      expect((await getMusicBrowseResults(db, "lives", new URLSearchParams("year=2026&classification=专场"))).total).toBe(1);
      expect((await getMusicBrowseResults(db, "lives", new URLSearchParams("year=1999"))).total).toBe(0);
    } finally { sqlite.close(); }
  });
  it("searches live tracks across years and combines explicit filters without expanding literal wildcards", async () => {
    const { sqlite, db } = fixture();
    try {
      expect((await getMusicBrowseResults(db, "lives", new URLSearchParams("q=black+bullet"))).total).toBe(FIXTURE_SIZE);
      expect((await getMusicBrowseResults(db, "lives", new URLSearchParams("q=black+bullet&year=2026&classification=拼盘"))).total).toBe(2);
      expect((await getMusicBrowseResults(db, "lives", new URLSearchParams("q=%25"))).total).toBe(0);
      expect((await getMusicBrowseResults(db, "songs", new URLSearchParams("q=Song+07"))).songs.map(song => song.id)).toEqual(["07"]);
      expect((await getMusicBrowseResults(db, "releases", new URLSearchParams("type=album"))).total).toBe(Math.floor(FIXTURE_SIZE / 2));
      expect((await getMusicBrowseResults(db, "releases", new URLSearchParams("type=album&type=single"))).total).toBe(FIXTURE_SIZE);
      expect((await getMusicBrowseResults(db, "releases", new URLSearchParams("type=ep"))).total).toBe(0);
    } finally { sqlite.close(); }
  });
  it("loads song rankings in larger batches and ranks within the selected phases", async () => {
    const { sqlite, db } = fixture();
    try {
      // Song 00 is in every fixture setlist; give a few more songs shows and phases.
      for (let i = FIXTURE_SIZE; i < MUSIC_SONG_BATCH_SIZE + 2; i++) {
        const id = String(i).padStart(2, "0");
        sqlite.prepare("INSERT INTO songs(id,slug,title,normalized_title,created_at,updated_at) VALUES(?,?,?,?, 'now','now')").run(id, `song-${id}`, `Song ${id}`, `song ${id}`);
      }
      sqlite.exec("UPDATE songs SET phase = 2 WHERE id IN ('00', '01', '02'); UPDATE songs SET phase = 3 WHERE id IN ('03', '04')");
      for (const [position, setlist, song] of [[2, "00", "01"], [2, "01", "01"], [3, "00", "02"], [4, "00", "03"], [5, "00", "04"]] as const) {
        sqlite.prepare("INSERT INTO setlist_entries(id,setlist_id,position,song_id,display_title,created_at) VALUES(?,?,?,?,'x','now')").run(`extra-${setlist}-${position}`, setlist, position, song);
      }
      const first = await getMusicBrowseResults(db, "songs", new URLSearchParams());
      expect(first).toMatchObject({ batch: MUSIC_SONG_BATCH_SIZE, shown: MUSIC_SONG_BATCH_SIZE, hasMore: true, ranked: true, maxShows: FIXTURE_SIZE });
      expect(first.songs.slice(0, 2).map(song => song.id)).toEqual(["00", "01"]);
      expect(first.ranks).toMatchObject({ "00": 1, "01": 2, "02": 3, "03": 3, "04": 3 });
      expect(first.ranks["05"]).toBeUndefined();
      const phase3 = await getMusicBrowseResults(db, "songs", new URLSearchParams("phase=3"));
      expect(phase3.songs.map(song => song.id)).toEqual(["03", "04"]);
      expect(phase3).toMatchObject({ total: 2, maxShows: 1, ranks: { "03": 1, "04": 1 } });
      const both = await getMusicBrowseResults(db, "songs", new URLSearchParams("phase=2&phase=3&q=Song+02"));
      expect(both.songs.map(song => song.id)).toEqual(["02"]);
      expect(both.ranks["02"]).toBe(3);
      expect((await getMusicBrowseResults(db, "songs", new URLSearchParams("sort=title-asc"))).ranked).toBe(false);
    } finally { sqlite.close(); }
  });
});
