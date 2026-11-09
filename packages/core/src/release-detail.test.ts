import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { getReleaseBySlug } from "./music-repository";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
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

describe("release detail tracks", () => {
  it("flags instrumental versions from their version relation", async () => {
    const { sqlite, db } = fixture();
    try {
      sqlite.exec(`
        INSERT INTO songs(id, slug, title, normalized_title, created_at, updated_at) VALUES ('s1', 'song', 'Song', 'song', 'now', 'now');
        INSERT INTO song_versions(id, song_id, slug, title, version_label, created_at, updated_at) VALUES
          ('vocal', 's1', 'song-original', 'Song', 'original', 'now', 'now'),
          ('inst', 's1', 'song-instrumental', 'Song <instrumental>', 'instrumental', 'now', 'now');
        INSERT INTO song_version_relations(id, child_version_id, parent_version_id, relation_type, created_at) VALUES ('r1', 'inst', 'vocal', 'instrumental_of', 'now');
        INSERT INTO releases(id, slug, title, release_type, release_date, created_at, updated_at) VALUES ('rel', 'single', 'Single', 'single', '2026-01-01', 'now', 'now');
        INSERT INTO release_tracks(id, release_id, song_version_id, track_number, display_title, created_at) VALUES
          ('t1', 'rel', 'vocal', 1, 'Song', 'now'),
          ('t2', 'rel', 'inst', 2, 'Song <instrumental>', 'now');
      `);
      const release = await getReleaseBySlug(db, "single");
      expect(release?.tracks.map(track => [track.version_id, Number(track.is_instrumental)])).toEqual([["vocal", 0], ["inst", 1]]);
    } finally { sqlite.close(); }
  });
});
