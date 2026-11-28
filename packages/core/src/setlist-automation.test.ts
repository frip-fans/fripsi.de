/// <reference types="node" />
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { authenticateAutomationToken, signAutomationToken } from "./automation-auth";
import { ContentAdminService } from "./content-admin";
import { getAdminSetlistById } from "./music-admin-repository";
import { baseSongTitle, findExistingSongs, listSetlistCandidates, SetlistAutomationService, SETLIST_RUN_SONG_LIMIT } from "./setlist-automation";
import { SETLIST_SYNC_POLICY_VERSION } from "./sync-policy";
import { createTestD1 } from "./test-d1";
import type { Actor } from "./types";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

const publisher: Actor = { id: "owner@example.com", type: "human", channel: "admin", scopes: ["events:read", "events:draft", "events:publish", "music:read", "music:write"] };
const secret = "unit-test-signing-key-not-a-real-secret", audience = "https://mcp.fripsi.test/mcp";
const SOURCE = "https://www.livefans.jp/events/1234567";
const TODAY = "2026-11-02";

async function setup(autoPublish = true) {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  const now = "2026-01-01T00:00:00.000Z";
  for (const [id, title] of [["song-a", "only my railgun"], ["song-b", "sister's noise"], ["song-c", "LEVEL5 -judgelight-"]]) {
    sqlite.prepare("INSERT INTO songs (id, slug, title, normalized_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, id, title, title.toLowerCase(), now, now);
  }
  sqlite.prepare("INSERT INTO song_versions (id, song_id, slug, title, version_label, created_at, updated_at) VALUES ('ver-a-2024', 'song-a', 'ver-a-2024', 'only my railgun -version2024-', 'version 2024', ?, ?)").run(now, now);
  sqlite.prepare("INSERT INTO song_aliases (song_id, alias, normalized_alias, created_at) VALUES ('song-b', 'シスターズノイズ', 'シスターズノイズ', ?)").run(now);
  const admin = new ContentAdminService(db);
  const live = (key: string, date: string, extra: object = {}) => admin.saveEvent({ published: true, idempotency_key: `setlist-live-${key}`, event: {
    title: `fripSide LIVE ${key}`, start_date: date, timezone: "Asia/Tokyo", category: "LIVE", classification: "专场", status: "scheduled",
    location_mode: "none", location_note: null, venues: [], channels: [], sources: [{ url: "https://fripside.net/live" }], ...extra,
  } }, publisher);
  const event = await live("yesterday", "2026-11-01");
  const runId = "setlists-2026-11-02", createdAt = new Date().toISOString();
  const candidates = await listSetlistCandidates(db, TODAY);
  sqlite.prepare(`INSERT INTO official_sync_runs (id, status, auto_publish, policy_version, input_json, created_at, updated_at) VALUES (?, 'running', ?, ?, ?, ?, ?)`)
    .run(runId, autoPublish ? 1 : 0, SETLIST_SYNC_POLICY_VERSION, JSON.stringify({ kind: "setlists", input: { events: candidates } }), createdAt, createdAt);
  const actor = await authenticateAutomationToken(await signAutomationToken(secret, audience, runId, createdAt),
    { DB: db, AUTOMATION_SIGNING_SECRET: secret, AUTOMATION_AUDIENCE: audience });
  return { db, sqlite, admin, live, event, runId, actor, candidates, service: new SetlistAutomationService(db) };
}

describe("setlist candidates", () => {
  it("lists ended shows without a setlist on their retry days only", async () => {
    const { db, sqlite, live, event, admin } = await setup();
    expect((await listSetlistCandidates(db, TODAY)).map((item) => [item.event_id, item.days_since])).toEqual([[event.id, 1]]);
    // Day 4 is not a retry day; day 5 is.
    expect(await listSetlistCandidates(db, "2026-11-05")).toEqual([]);
    expect(await listSetlistCandidates(db, "2026-11-05", false)).toHaveLength(1);
    expect(await listSetlistCandidates(db, "2026-11-06")).toHaveLength(1);
    // Not yet over, and long over.
    expect(await listSetlistCandidates(db, "2026-11-01", false)).toEqual([]);
    expect(await listSetlistCandidates(db, "2026-12-02", false)).toEqual([]);

    const festival = await live("festival", "2026-11-01", { classification: "拼盘" });
    await live("broadcast", "2026-11-01", { classification: "生放送" });
    await live("media", "2026-11-01", { category: "MEDIA", classification: "TV" });
    const cancelled = await live("cancelled", "2026-11-01", { status: "cancelled" });
    expect((await listSetlistCandidates(db, TODAY)).map((item) => item.event_id).sort()).toEqual([event.id, festival.id].sort());
    expect(cancelled.status).toBe("cancelled");

    await admin.saveSetlist({ idempotency_key: "existing-setlist", event_id: festival.id, performance_label: "本公演", completeness: "complete", confidence: "reported",
      notes: null, published: true, entries: [{ song_id: "song-a", section: "main" }], sources: [] }, publisher);
    sqlite.prepare(`INSERT INTO change_sets (id, operation, target_event_id, payload_json, reason, status, idempotency_key, created_by, created_via, created_at, subject_type)
      VALUES ('chg-waiting', 'create', ?, '{}', 'waiting', 'proposed', 'waiting-key', 'someone', 'mcp', '2026-11-02T00:00:00Z', 'setlist')`).run(event.id);
    expect(await listSetlistCandidates(db, TODAY)).toEqual([]);
  });
});

describe("finding songs before creating them", () => {
  it("removes trailing version marks but keeps titles that end in one", () => {
    expect(baseSongTitle("only my railgun -version2024-")).toBe("only my railgun");
    expect(baseSongTitle("future gazer (Live ver.)")).toBe("future gazer");
    expect(baseSongTitle("-judgelight-")).toBe("-judgelight-");
  });
  it("matches by title, alias, version title and base title, ignoring case, width and punctuation", async () => {
    const { db } = await setup();
    const matched = async (name: string) => (await findExistingSongs(db, [name])).map((match) => [match.song_id, match.matched_on]);
    expect(await matched("ONLY MY RAILGUN")).toEqual([["song-a", "title"]]);
    expect(await matched("ｏｎｌｙ　ｍｙ　ｒａｉｌｇｕｎ")).toEqual([["song-a", "title"]]);
    expect(await matched("Sisters Noise")).toEqual([["song-b", "title"]]);
    expect(await matched("シスターズ・ノイズ")).toEqual([["song-b", "alias"]]);
    expect(await matched("only my railgun -version 2024-")).toEqual([["song-a", "version"]]);
    expect(await matched("only my railgun -Live at Budokan-")).toEqual([["song-a", "base_title"]]);
    expect(await matched("LEVEL5-judgelight-")).toEqual([["song-c", "title"]]);
    expect(await matched("Red Liberation")).toEqual([]);
  });
});

describe("the setlist collection task", () => {
  it("gets its own identity and cannot use the event tools", async () => {
    const { db, actor } = await setup();
    expect(actor).toMatchObject({ automation_kind: "setlists", scopes: ["events:read", "events:draft", "music:write", "events:publish", "events:auto_publish"] });
    await expect(new SetlistAutomationService(db).findSongs("x", { ...actor, automation_kind: undefined })).rejects.toMatchObject({ status: 403 });
    // An identity of the official event sync is refused, whatever it claims.
    const { db: other, sqlite } = createTestD1(); databases.push(sqlite);
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO official_sync_runs (id, status, auto_publish, policy_version, created_at, updated_at) VALUES ('official-x', 'running', 1, 'official-sync-v2', ?, ?)").run(now, now);
    const official: Actor = { id: "official-sync-agent", type: "ai", channel: "mcp", automation_run_id: "official-x", automation_kind: "setlists", scopes: ["events:read", "events:draft", "events:publish", "events:auto_publish"] };
    await expect(new SetlistAutomationService(other).findSongs("x", official)).rejects.toMatchObject({ code: "inactive_run" });
  });

  it("says whether a song exists and refuses to create one that does", async () => {
    const { service, actor, sqlite } = await setup();
    const found = await service.findSongs("Only My Railgun -version2024-", actor);
    expect(found).toMatchObject({ exists: true, next_action: "use_matched_song_id" });
    expect(found.matches[0]).toMatchObject({ song_id: "song-a", matched_on: "version" });
    expect(found.matches[0].versions.map((version) => version.version_id)).toContain("ver-a-2024");
    expect(await service.findSongs("Red Liberation", actor)).toMatchObject({ exists: false, matches: [] });

    await expect(service.createSong({ title: "ONLY MY RAILGUN", original_artist: "fripSide", source_url: SOURCE, reason: "歌单中出现" }, actor))
      .rejects.toMatchObject({ code: "duplicate_song", details: { existing: [expect.objectContaining({ song_id: "song-a" })] } });
    await expect(service.createSong({ title: "New Song", aliases: ["シスターズノイズ"], original_artist: "fripSide", source_url: SOURCE, reason: "歌单中出现" }, actor))
      .rejects.toMatchObject({ code: "duplicate_song" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM songs").get()).toMatchObject({ n: 3 });
  });

  it("creates a missing song once, then publishes a setlist for its own event", async () => {
    const { service, actor, event, db, sqlite, runId } = await setup();
    const created = await service.createSong({ title: "Red Liberation", original_artist: "fripSide", source_url: SOURCE, reason: "歌单中出现，音乐库没有" }, actor);
    expect(created).toMatchObject({ status: "created", title: "Red Liberation" });
    const again = await service.createSong({ title: "Red Liberation", original_artist: "fripSide", source_url: SOURCE, reason: "重试" }, actor).catch((error) => error);
    expect(again).toMatchObject({ code: "duplicate_song" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM songs WHERE title = 'Red Liberation'").get()).toMatchObject({ n: 1 });
    const cover = await service.createSong({ title: "Cover Song", original_artist: "Someone Else", source_url: SOURCE, reason: "翻唱" }, actor);
    expect(sqlite.prepare("SELECT original_artist, published FROM songs WHERE id = ?").get((cover as { song_id: string }).song_id)).toMatchObject({ original_artist: "Someone Else", published: 1 });

    const entries = [{ song_id: "song-a", performed_version_id: "ver-a-2024" }, { song_id: (created as { song_id: string }).song_id }, { song_id: "song-b", section: "encore" }];
    const first = await service.proposeSetlist({ event_id: event.id, completeness: "partial", entries: entries.slice(0, 2), source_url: SOURCE, reason: "LiveFans" }, actor);
    const second = await service.proposeSetlist({ event_id: event.id, completeness: "complete", entries, source_url: SOURCE, reason: "LiveFans" }, actor);
    expect(sqlite.prepare("SELECT status FROM change_sets WHERE id = ?").get(first.change_set_id)).toMatchObject({ status: "discarded" });

    await expect(service.publish(second.change_set_id, "0".repeat(64), actor)).rejects.toMatchObject({ code: "preview_required" });
    const preview = await service.preview(second.change_set_id, actor);
    expect(preview.warnings).toEqual([]);
    expect(preview.setlist?.entries.map((entry) => [entry.display_title, entry.section])).toEqual([
      ["only my railgun -version2024-", "main"], ["Red Liberation", "main"], ["sister's noise", "encore"]]);
    const outcome = await service.publish(second.change_set_id, preview.preview_digest, actor);
    expect(outcome).toMatchObject({ status: "published", event_id: event.id });
    const setlist = await getAdminSetlistById(db, outcome.setlist_id!);
    expect(setlist).toMatchObject({ event_id: event.id, confidence: "reported", completeness: "complete", published: true, entry_count: 3 });
    expect(setlist!.sources.map((source) => source.url)).toEqual([SOURCE]);
    expect(await service.publish(second.change_set_id, preview.preview_digest, actor)).toMatchObject({ status: "unchanged" });
    expect(sqlite.prepare("SELECT actor_id, channel FROM audit_logs WHERE action = 'change.publish_setlist_create'").get()).toMatchObject({ actor_id: "official-sync-agent", channel: "mcp" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM official_sync_changes WHERE run_id = ?").get(runId)).toMatchObject({ n: 4 });
    expect(await listSetlistCandidates(db, TODAY)).toEqual([]);
  });

  it("only touches events of its own run and never an existing setlist", async () => {
    const { service, actor, event, live, admin } = await setup();
    const other = await live("not-in-run", "2026-10-20");
    const input = { completeness: "complete", entries: [{ song_id: "song-a" }], source_url: SOURCE, reason: "report" };
    await expect(service.proposeSetlist({ ...input, event_id: other.id }, actor)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.proposeSetlist({ ...input, event_id: event.id, entries: [{ song_id: "missing" }] }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(service.proposeSetlist({ ...input, event_id: event.id, source_url: "http://example.com/setlist" }, actor)).rejects.toThrow();
    const proposed = await service.proposeSetlist({ ...input, event_id: event.id }, actor);
    const preview = await service.preview(proposed.change_set_id, actor);
    // A person adds the setlist in the meantime: the task must not replace it.
    await admin.saveSetlist({ idempotency_key: "manual-setlist", event_id: event.id, performance_label: "本公演", completeness: "complete", confidence: "official",
      notes: null, published: true, entries: [{ song_id: "song-b", section: "main" }], sources: [] }, publisher);
    await expect(service.publish(proposed.change_set_id, preview.preview_digest, actor)).rejects.toMatchObject({ code: "preview_changed" });
  });

  it("uses the official site as an official source", async () => {
    const { service, actor, event, db } = await setup();
    const proposed = await service.proposeSetlist({ event_id: event.id, completeness: "complete", entries: [{ song_id: "song-a" }], source_url: "https://fripside.net/contents/999", reason: "官方报道" }, actor);
    const preview = await service.preview(proposed.change_set_id, actor);
    const outcome = await service.publish(proposed.change_set_id, preview.preview_digest, actor);
    expect(await getAdminSetlistById(db, outcome.setlist_id!)).toMatchObject({ confidence: "official" });
  });

  it("leaves proposals for a person when the run may not publish", async () => {
    const { service, actor, event, sqlite } = await setup(false);
    expect(actor.scopes).toEqual(["events:read", "events:draft", "music:write"]);
    expect(await service.createSong({ title: "Red Liberation", original_artist: "fripSide", source_url: SOURCE, reason: "new" }, actor)).toMatchObject({ status: "proposed" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM songs").get()).toMatchObject({ n: 3 });
    const proposed = await service.proposeSetlist({ event_id: event.id, completeness: "complete", entries: [{ song_id: "song-a" }], source_url: SOURCE, reason: "report" }, actor);
    const preview = await service.preview(proposed.change_set_id, actor);
    await expect(service.publish(proposed.change_set_id, preview.preview_digest, actor)).rejects.toMatchObject({ status: 403 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM setlists").get()).toMatchObject({ n: 0 });
  });

  it("caps how many songs one run may create", async () => {
    const { service, actor } = await setup();
    for (let index = 0; index < SETLIST_RUN_SONG_LIMIT; index++) {
      await service.createSong({ title: `Brand new song ${"abcdefgh"[index]}`, original_artist: "fripSide", source_url: SOURCE, reason: "new" }, actor);
    }
    await expect(service.createSong({ title: "One too many", original_artist: "fripSide", source_url: SOURCE, reason: "new" }, actor)).rejects.toMatchObject({ code: "run_limit" });
  });
});
