/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { listVersionVotes, setVersionVote } from "./song-votes";

const migrationsDirectory = new URL("../../../migrations/", import.meta.url);

function applyMigration(sqlite: DatabaseSync, name: string) {
  sqlite.exec(readFileSync(new URL(name, migrationsDirectory), "utf8"));
}

function fixture(beforeVoteMigrations?: (sqlite: DatabaseSync) => void) {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql") && name < "0012").sort()) applyMigration(sqlite, name);
  sqlite.exec(`INSERT INTO songs (id,slug,title,normalized_title,created_at,updated_at) VALUES ('song','song','Song','song','now','now');
    INSERT INTO song_versions (id,song_id,slug,title,created_at,updated_at) VALUES ('version','song','version','Version','now','now'), ('hidden','song','hidden','Hidden','now','now');
    UPDATE song_versions SET published=0 WHERE id='hidden';`);
  beforeVoteMigrations?.(sqlite);
  applyMigration(sqlite, "0012_song_version_votes.sql");
  applyMigration(sqlite, "0013_song_version_phases.sql");
  const db = { prepare(sql: string) { const statement = sqlite.prepare(sql); let args: SQLInputValue[] = [];
    const query = { bind(...values: SQLInputValue[]) { args = values; return query; }, async first() { return statement.get(...args) ?? null; }, async all() { return { results: statement.all(...args), success: true }; }, async run() { return statement.run(...args); } }; return query;
  } } as unknown as D1Database;
  return { sqlite, db };
}

describe("community version votes", () => {
  it("hides the average until five votes, replaces a vote and hides it again after cancellation", async () => {
    const { sqlite, db } = fixture();
    try {
      for (let i = 1; i <= 4; i++) await setVersionVote(db, "version", `v${i}`, i);
      expect(await listVersionVotes(db, "v1")).toMatchObject([{ id: "version", vote_count: 4, average: null, my_score: 1 }]);
      await setVersionVote(db, "version", "v1", 10);
      expect((await listVersionVotes(db, "v1"))[0]).toMatchObject({ vote_count: 4, average: null, my_score: 10 });
      await setVersionVote(db, "version", "v5", 10);
      expect((await listVersionVotes(db, "v1"))[0]).toMatchObject({ vote_count: 5, average: 5.8, my_score: 10 });
      await setVersionVote(db, "version", "v5", null);
      expect((await listVersionVotes(db, "v5"))[0]).toMatchObject({ vote_count: 4, average: null, my_score: null });
      expect(await setVersionVote(db, "hidden", "v1", 3)).toBe(false);
    } finally { sqlite.close(); }
  });

  it("accepts both score boundaries and rejects invalid scores without changing the vote", async () => {
    const { sqlite, db } = fixture();
    try {
      await setVersionVote(db, "version", "v1", 1);
      expect((await listVersionVotes(db, "v1"))[0].my_score).toBe(1);
      await setVersionVote(db, "version", "v1", 10);
      for (const score of [0, -1, 11, 2.5, NaN, Infinity]) {
        await expect(setVersionVote(db, "version", "v1", score)).rejects.toThrow("Invalid score");
      }
      expect((await listVersionVotes(db, "v1"))[0]).toMatchObject({ my_score: 10, vote_count: 1 });
      const insert = sqlite.prepare("INSERT INTO song_version_votes (version_id, voter_id, score, updated_at) VALUES ('version', 'invalid', ?, 'now')");
      expect(() => insert.run(0)).toThrow();
      expect(() => insert.run(11)).toThrow();
      expect(await setVersionVote(db, "missing", "v1", 10)).toBe(false);
      sqlite.exec("UPDATE songs SET published = 0 WHERE id = 'song'");
      expect(await listVersionVotes(db, "v1")).toEqual([]);
      expect(await setVersionVote(db, "version", "v1", 10)).toBe(false);
    } finally { sqlite.close(); }
  });

  it("upgrades legacy preview tables without rescaling votes or losing phase tags", async () => {
    const { sqlite, db } = fixture((legacy) => {
      legacy.exec(`CREATE TABLE song_version_votes (
        version_id TEXT NOT NULL REFERENCES song_versions(id) ON DELETE CASCADE,
        voter_id TEXT NOT NULL, score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
        updated_at TEXT NOT NULL, PRIMARY KEY (version_id, voter_id));
        INSERT INTO song_version_votes VALUES ('version', 'legacy', 4, 'original-time');
        CREATE TABLE song_version_phases (
          version_id TEXT NOT NULL REFERENCES song_versions(id) ON DELETE CASCADE,
          phase INTEGER NOT NULL CHECK (phase IN (1, 2, 3)), PRIMARY KEY (version_id, phase));
        INSERT INTO song_version_phases VALUES ('version', 2);`);
    });
    try {
      expect(sqlite.prepare("SELECT * FROM song_version_votes").get()).toMatchObject({
        version_id: "version", voter_id: "legacy", score: 4, updated_at: "original-time"
      });
      expect((await listVersionVotes(db, "legacy"))[0]).toMatchObject({ my_score: 4, vote_count: 1, phases: [2] });
      await setVersionVote(db, "version", "legacy", 10);
      expect((await listVersionVotes(db, "legacy"))[0]).toMatchObject({ my_score: 10, vote_count: 1, phases: [2] });
      sqlite.exec("DELETE FROM song_versions WHERE id = 'version'");
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM song_version_votes").get()).toMatchObject({ count: 0 });
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM song_version_phases").get()).toMatchObject({ count: 0 });
    } finally { sqlite.close(); }
  });
  it("returns all published versions beyond the old 500-item catalog limit", async () => {
    const { sqlite, db } = fixture();
    try {
      const insert = sqlite.prepare("INSERT INTO song_versions (id,song_id,slug,title,created_at,updated_at) VALUES (?, 'song', ?, ?, 'now', 'now')");
      for (let i = 0; i < 501; i++) insert.run(`extra-${i}`, `extra-${i}`, `Extra ${i}`);
      expect(await listVersionVotes(db, "v1")).toHaveLength(502);
    } finally { sqlite.close(); }
  });

  it("returns distinct public release associations and independently assigned phases", async () => {
    const { sqlite, db } = fixture();
    try {
      sqlite.exec(`INSERT INTO releases (id,slug,title,release_type,published,created_at,updated_at) VALUES ('album','album','Album','album',1,'now','now'), ('single','single','Single','single',1,'now','now'), ('private','private','Private','single',0,'now','now');
        INSERT INTO release_tracks (id,release_id,song_version_id,track_number,display_title,created_at) VALUES ('a','album','version',1,'Version','now'),('b','album','version',2,'Version','now'),('c','single','version',1,'Version','now'),('d','private','version',1,'Version','now');
        INSERT INTO song_version_phases (version_id,phase) VALUES ('version',2),('version',3);`);
      const [version] = await listVersionVotes(db, 'v1');
      expect(version.releases.map((release) => release.id)).toEqual(['album', 'single']);
      expect(version.phases).toEqual([2,3]);
      expect(version.vote_count).toBe(0);
    } finally { sqlite.close(); }
  });

});
