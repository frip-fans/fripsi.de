/// <reference types="node" />
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ChangeService } from "./change-service";
import { ContentAdminService } from "./content-admin";
import { getAdminSetlistById } from "./music-admin-repository";
import { createTestD1 } from "./test-d1";
import type { Actor } from "./types";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

const publisher: Actor = { id: "owner@example.com", type: "human", channel: "admin", scopes: ["events:read", "events:draft", "events:publish", "music:read", "music:write"] };
const assistant: Actor = { id: "owner@example.com", type: "ai", channel: "mcp", chat_session_id: "chat-1", scopes: ["events:read", "events:draft"] };
const SOURCE = "https://fripside.net/setlist-report";

async function setup() {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  const now = "2026-01-01T00:00:00.000Z";
  for (const [id, title] of [["song-a", "only my railgun"], ["song-b", "sister's noise"], ["song-c", "LEVEL5 -judgelight-"]]) {
    sqlite.prepare("INSERT INTO songs (id, slug, title, normalized_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, id, title, title.toLowerCase(), now, now);
  }
  sqlite.prepare("INSERT INTO song_versions (id, song_id, slug, title, version_label, created_at, updated_at) VALUES ('ver-a-2020', 'song-a', 'ver-a-2020', 'only my railgun -version 2020-', 'version 2020', ?, ?)").run(now, now);
  const admin = new ContentAdminService(db);
  const event = await admin.saveEvent({ published: true, idempotency_key: "setlist-test-event", event: {
    title: "fripSide LIVE", start_date: "2026-05-01", timezone: "Asia/Tokyo", category: "LIVE", status: "scheduled",
    location_mode: "none", location_note: null, venues: [], channels: [], sources: [{ url: "https://fripside.net/live" }],
  } }, publisher);
  const service = new ChangeService(db);
  const body = (entries: object[], extra: object = {}) => ({ completeness: "complete", confidence: "reported", entries, ...extra });
  const propose = (input: object, key: string, actor = assistant) => service.proposeSetlist({ source_url: SOURCE, reason: "现场记录", idempotency_key: key, ...input }, actor);
  return { db, sqlite, admin, service, event, body, propose };
}

describe("setlist proposals", () => {
  it("proposes, previews and publishes a new setlist for a show", async () => {
    const { db, sqlite, service, event, body, propose } = await setup();
    const change = await propose({ event_id: event.id, setlist: body([
      { song_id: "song-a", performed_version_id: "ver-a-2020" },
      { song_id: "song-b", notes: "short ver." },
      { song_id: "song-c", section: "encore" },
    ]) }, "setlist-create-1");
    expect(change).toMatchObject({ operation: "create", subject_type: "setlist", subject_id: null, target_event_id: event.id, base_version: null, chat_session_id: "chat-1", source_url: SOURCE });
    expect(await propose({ event_id: event.id, setlist: body([]) }, "setlist-create-1")).toMatchObject({ id: change.id });

    const preview = await service.preview(change.id, assistant);
    expect(preview.before).toMatchObject({ id: event.id });
    expect(preview.warnings).toEqual([]);
    expect(preview.setlist).toMatchObject({ setlist_id: null, before: null, after: { performance_label: "本公演", published: true, sources: [SOURCE] } });
    expect(preview.setlist!.after.entries.map((entry) => [entry.position, entry.display_title, entry.section])).toEqual([
      [1, "only my railgun -version 2020-", "main"], [2, "sister's noise", "main"], [3, "LEVEL5 -judgelight-", "encore"],
    ]);
    // Nothing is written until a publisher publishes; the assistant cannot.
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM setlists").get()).toMatchObject({ count: 0 });
    await expect(service.publish(change.id, assistant, "setlist-publish-assistant")).rejects.toMatchObject({ code: "forbidden" });

    const published = await service.publish(change.id, publisher, "setlist-publish-1");
    expect(published.id).toBe(event.id);
    const row = sqlite.prepare("SELECT status, subject_id, reviewed_by FROM change_sets WHERE id = ?").get(change.id) as { status: string; subject_id: string; reviewed_by: string };
    expect(row).toMatchObject({ status: "published", reviewed_by: "owner@example.com" });
    const setlist = (await getAdminSetlistById(db, row.subject_id))!;
    expect(setlist).toMatchObject({ event_id: event.id, performance_label: "本公演", completeness: "complete", confidence: "reported", published: true });
    expect(setlist.entries.map((entry) => [entry.song_id, entry.performed_version_id, entry.section, entry.notes])).toEqual([
      ["song-a", "ver-a-2020", "main", null], ["song-b", null, "main", "short ver."], ["song-c", null, "encore", null],
    ]);
    expect(setlist.sources.map((source) => source.url)).toEqual([SOURCE]);
    const actions = sqlite.prepare("SELECT action FROM audit_logs WHERE action LIKE '%setlist%' ORDER BY rowid").all().map((log) => log.action);
    expect(actions).toEqual(["change.propose_setlist_create", "content.setlist.create", "change.publish_setlist_create"]);

    // A replayed publish returns the same show and writes nothing more.
    expect((await service.publish(change.id, publisher, "setlist-publish-1")).id).toBe(event.id);
    await expect(service.publish(change.id, publisher, "setlist-publish-2")).rejects.toMatchObject({ code: "invalid_state" });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM setlists").get()).toMatchObject({ count: 1 });
    expect((await service.preview(change.id, publisher)).warnings).toEqual(["提案当前状态为 published，不能再次发布"]);
  });

  it("replaces an existing setlist, keeps its sources and refuses once it has moved on", async () => {
    const { db, admin, service, event, body, propose } = await setup();
    const original = await admin.saveSetlist({ idempotency_key: "setlist-original", event_id: event.id, performance_label: "本公演",
      completeness: "partial", confidence: "unverified", published: true, sources: [{ url: "https://example.com/first-report" }],
      entries: [{ song_id: "song-a", section: "main" }, { song_id: "song-b", section: "main" }] }, publisher);

    await expect(propose({ setlist_id: original.id, setlist: body([]) }, "setlist-update-no-version")).rejects.toThrow();
    await expect(propose({ setlist_id: original.id, expected_updated_at: "2020-01-01T00:00:00.000Z", setlist: body([]) }, "setlist-update-stale"))
      .rejects.toMatchObject({ code: "version_conflict" });
    await expect(propose({ setlist_id: "mus_set_missing", expected_updated_at: "x", setlist: body([]) }, "setlist-update-missing")).rejects.toMatchObject({ code: "not_found" });

    const entries = [{ song_id: "song-b" }, { song_id: "song-a" }, { song_id: "song-c", section: "encore" }];
    const first = await propose({ setlist_id: original.id, expected_updated_at: original.updated_at, setlist: body(entries) }, "setlist-update-1");
    const second = await propose({ setlist_id: original.id, expected_updated_at: original.updated_at, setlist: body([{ song_id: "song-c" }]) }, "setlist-update-2");
    expect(first).toMatchObject({ operation: "update", subject_id: original.id, target_event_id: event.id });

    const preview = await service.preview(first.id, publisher);
    expect(preview.setlist!.before!.entries.map((entry) => entry.song_id)).toEqual(["song-a", "song-b"]);
    expect(preview.setlist!.after.entries.map((entry) => entry.song_id)).toEqual(["song-b", "song-a", "song-c"]);
    expect(preview.setlist!.after.sources).toEqual(["https://example.com/first-report", SOURCE]);

    await service.publish(first.id, publisher, "setlist-update-publish-1");
    const saved = (await getAdminSetlistById(db, original.id))!;
    expect(saved).toMatchObject({ completeness: "complete", confidence: "reported" });
    expect(saved.entries.map((entry) => entry.song_id)).toEqual(["song-b", "song-a", "song-c"]);
    expect(saved.sources.map((source) => source.url).sort()).toEqual(["https://example.com/first-report", SOURCE].sort());

    // The second proposal was written against the setlist as it was before the first one landed.
    expect((await service.preview(second.id, publisher)).warnings).toEqual(["歌单在提案之后被修改过，需要基于最新内容重新提案"]);
    await expect(service.publish(second.id, publisher, "setlist-update-publish-2")).rejects.toMatchObject({ code: "version_conflict" });
    expect((await getAdminSetlistById(db, original.id))!.entries).toHaveLength(3);
  });

  it("refuses songs, versions, shows and duplicates it cannot publish", async () => {
    const { admin, event, body, propose } = await setup();
    await expect(propose({ event_id: event.id, setlist: body([{ song_id: "song-missing" }]) }, "setlist-bad-song")).rejects.toMatchObject({ code: "invalid_song" });
    await expect(propose({ event_id: event.id, setlist: body([{ song_id: "song-b", performed_version_id: "ver-a-2020" }]) }, "setlist-bad-version")).rejects.toMatchObject({ code: "invalid_version" });
    await expect(propose({ event_id: "evt_missing", setlist: body([{ song_id: "song-a" }]) }, "setlist-bad-event")).rejects.toMatchObject({ code: "not_found" });
    await expect(propose({ setlist: body([{ song_id: "song-a" }]) }, "setlist-no-event")).rejects.toThrow();
    await expect(propose({ event_id: event.id, setlist: body([{ song_id: "song-a" }]), source_url: "http://insecure.example" }, "setlist-bad-source")).rejects.toThrow();
    await expect(propose({ event_id: event.id, setlist: body([{ song_id: "song-a" }]) }, "setlist-no-scope", { ...assistant, scopes: ["events:read"] })).rejects.toMatchObject({ code: "forbidden" });

    const existing = await admin.saveSetlist({ idempotency_key: "setlist-existing", event_id: event.id, performance_label: "本公演",
      completeness: "complete", confidence: "official", published: true, sources: [], entries: [{ song_id: "song-a", section: "main" }] }, publisher);
    await expect(propose({ event_id: event.id, setlist: body([{ song_id: "song-b" }]) }, "setlist-duplicate"))
      .rejects.toMatchObject({ code: "invalid_setlist", message: expect.stringContaining(existing.id) });
    // A second performance of the same show is a different setlist.
    expect(await propose({ event_id: event.id, setlist: body([{ song_id: "song-b" }], { performance_label: "夜公演" }) }, "setlist-second-show")).toMatchObject({ operation: "create" });
  });

  it("leaves event proposals as they were", async () => {
    const { service, event } = await setup();
    const change = await service.proposeUpdate({ target_event_id: event.id, expected_version: event.version, patch: { remark: "note" },
      source_url: SOURCE, reason: "备注", idempotency_key: "event-update-1" }, assistant);
    expect(change).toMatchObject({ subject_type: "event", subject_id: null });
    expect((await service.preview(change.id, assistant)).setlist).toBeUndefined();
    expect(await service.publish(change.id, publisher, "event-update-publish-1")).toMatchObject({ remark: "note", version: event.version + 1 });
  });
});
