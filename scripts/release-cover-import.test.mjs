import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { selectCover, coverUpdateSql } from "./build-release-cover-import.mjs";

test("edition matching prefers the matching regular edition and rejects a different edition", () => {
  const entry = { cover_url: "main", editions: [
    { title: "初回限定盤", catalog_number: "WPZL-32314/5", cover_url: "limited" },
    { title: "通常盤", catalog_number: "WPCL-13787", cover_url: "regular" },
  ] };
  assert.equal(selectCover(entry, ["WPZL-32314～5", "WPCL-13787"]).cover_url, "regular");
  assert.equal(selectCover(entry, ["WPZL-32314～5"]).cover_url, "limited");
  assert.equal(selectCover(entry, ["GNCA-0001"]), null);
  assert.equal(selectCover({cover_url: "main", editions: []}, []).cover_url, "main");
});

test("content patch preserves edited covers and requires slug, date and source matches", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE releases (id TEXT, slug TEXT, release_date TEXT, cover_url TEXT, cover_source_url TEXT, updated_at TEXT); CREATE TABLE catalog_sources (subject_type TEXT, subject_id TEXT, url TEXT);");
  const record = { release_slug: "test", release_date: "2026-08-26", source_url: "https://fripside.net/musics/20902", cover_url: "/media/covers/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg" };
  db.prepare("INSERT INTO releases VALUES ('r1', 'test', '2026-08-26', NULL, NULL, 'old')").run();
  db.exec(coverUpdateSql(record));
  assert.equal(db.prepare("SELECT cover_url FROM releases").get().cover_url, null);
  db.prepare("INSERT INTO catalog_sources VALUES ('release','r1',?)").run(record.source_url);
  db.exec(coverUpdateSql({...record, release_date: "2026-08-25"}));
  assert.equal(db.prepare("SELECT cover_url FROM releases").get().cover_url, null);
  db.exec(coverUpdateSql({...record, release_slug: "other"}));
  assert.equal(db.prepare("SELECT cover_url FROM releases").get().cover_url, null);
  db.exec(coverUpdateSql(record));
  assert.equal(db.prepare("SELECT cover_url FROM releases").get().cover_url, record.cover_url);
  assert.notEqual(db.prepare("SELECT updated_at FROM releases").get().updated_at, "old");
  db.exec(coverUpdateSql({...record, cover_url: "/media/covers/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg"}));
  assert.equal(db.prepare("SELECT cover_url FROM releases").get().cover_url, record.cover_url);
  db.close();
});
