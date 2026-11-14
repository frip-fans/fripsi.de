import { describe, expect, it } from "vitest";
import { countAdminReleases, countAdminSetlists, countAdminSongs, listAdminReleases, listAdminSetlists, listAdminSongs } from "./music-admin-repository";
import { createTestD1 } from "./test-d1";

function fixture() {
  const { db, sqlite } = createTestD1();
  const song = sqlite.prepare("INSERT INTO songs (id, slug, title, normalized_title, created_at, updated_at) VALUES (?, ?, ?, ?, 'now', ?)");
  // Imported rows share one updated_at, so only the tie-breakers order them.
  for (const id of ["a", "b", "c", "d", "e"]) song.run(`song_${id}`, id, "Same title", "sametitle", "2026-01-01");
  const release = sqlite.prepare("INSERT INTO releases (id, slug, title, release_type, release_date, created_at, updated_at) VALUES (?, ?, ?, 'single', ?, 'now', 'now')");
  for (const id of ["a", "b", "c"]) release.run(`rel_${id}`, id, "Same single", "2020-01-01");
  const event = sqlite.prepare(`INSERT INTO events (id, slug, title, start_date, timezone, category, status, published, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Asia/Tokyo', 'LIVE', 'completed', 1, 'now', 'now')`);
  const setlist = sqlite.prepare("INSERT INTO setlists (id, event_id, completeness, confidence, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'now', 'now')");
  const rows: Array<[string, string, string, string, number, boolean]> = [
    ["done", "2026-05-01", "complete", "official", 1, true],
    ["draft", "2026-04-01", "complete", "reported", 0, true],
    // In three buckets at once: partial, unverified and without songs.
    ["rough", "2026-03-01", "partial", "unverified", 1, false],
    ["empty", "2026-02-01", "complete", "official", 1, false],
  ];
  for (const [id, date, completeness, confidence, published, hasSong] of rows) {
    event.run(`ev_${id}`, id, `Live ${id}`, date);
    setlist.run(`sl_${id}`, `ev_${id}`, completeness, confidence, published);
    if (hasSong) sqlite.prepare("INSERT INTO setlist_entries (id, setlist_id, position, song_id, display_title, created_at) VALUES (?, ?, 1, 'song_a', 'Same title', 'now')").run(`se_${id}`, `sl_${id}`);
  }
  return db;
}

describe("admin music list paging", () => {
  it("walks songs page by page without repeating or skipping tied rows", async () => {
    const db = fixture();
    const pages = [await listAdminSongs(db, undefined, 2), await listAdminSongs(db, undefined, 2, 2), await listAdminSongs(db, undefined, 2, 4)];
    expect(pages.flat().map((song) => song.id)).toEqual(["song_a", "song_b", "song_c", "song_d", "song_e"]);
    expect(await countAdminSongs(db)).toBe(5);
  });

  it("walks releases page by page and counts them", async () => {
    const db = fixture();
    const pages = [await listAdminReleases(db, undefined, 2), await listAdminReleases(db, undefined, 2, 2)];
    expect(pages.flat().map((release) => release.id)).toEqual(["rel_a", "rel_b", "rel_c"]);
    expect(await countAdminReleases(db)).toBe(3);
  });

  it("counts search results the same way it lists them", async () => {
    const db = fixture();
    expect(await countAdminSongs(db, "no such song")).toBe(0);
    expect(await listAdminSongs(db, "no such song")).toEqual([]);
    expect(await countAdminReleases(db, "Same single")).toBe((await listAdminReleases(db, "Same single")).length);
  });
});

describe("admin setlist follow-ups", () => {
  it("counts each bucket and counts a setlist once in the union", async () => {
    expect(await countAdminSetlists(fixture())).toEqual({ all: 4, draft: 1, incomplete: 1, unverified: 1, empty: 2, follow_up: 3 });
  });

  it("lists exactly the rows a bucket counts", async () => {
    const db = fixture();
    const ids = async (followUp: "draft" | "incomplete" | "unverified" | "empty") => (await listAdminSetlists(db, undefined, 50, { followUp })).map((setlist) => setlist.id);
    expect(await ids("draft")).toEqual(["sl_draft"]);
    expect(await ids("incomplete")).toEqual(["sl_rough"]);
    expect(await ids("unverified")).toEqual(["sl_rough"]);
    expect(await ids("empty")).toEqual(["sl_rough", "sl_empty"]);
  });

  it("pages within a bucket", async () => {
    const db = fixture();
    expect((await listAdminSetlists(db, undefined, 1, { followUp: "empty", offset: 1 })).map((setlist) => setlist.id)).toEqual(["sl_empty"]);
    expect((await listAdminSetlists(db, undefined, 2, { offset: 2 })).map((setlist) => setlist.id)).toEqual(["sl_rough", "sl_empty"]);
  });

  it("returns zeroes rather than nulls when nothing matches", async () => {
    expect(await countAdminSetlists(fixture(), "no such live")).toEqual({ all: 0, draft: 0, incomplete: 0, unverified: 0, empty: 0, follow_up: 0 });
  });
});
