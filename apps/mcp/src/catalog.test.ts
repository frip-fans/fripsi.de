/// <reference types="node" />
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { CHAT_SCOPES, ContentAdminService, type Actor, type ChangePreview } from "@frip-fan/core";
import { createTestD1 } from "../../../packages/core/src/test-d1";
import { createServer } from "./index";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

const publisher: Actor = { id: "maintainer@example.com", type: "human", channel: "mcp",
  scopes: ["events:read", "events:draft", "events:publish", "music:read", "music:write"] };

async function connect(actor: Actor, db: D1Database) {
  const server = createServer({ DB: db, SITE_URL: "https://fripsi.example" }, actor);
  const client = new Client({ name: "catalog-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async <T>(name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError, JSON.stringify(response.structuredContent)).not.toBe(true);
    return (response.structuredContent as { result: T }).result;
  };
  const fail = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError).toBe(true);
    return JSON.stringify(response.structuredContent);
  };
  const publish = async <T>(id: string) => call<T>("changes.publish", { change_set_id: id, confirm: true, idempotency_key: `publish-${id}` });
  return { client, call, fail, publish };
}

interface Proposed { change: { id: string; subject_type: string; operation: string } }

it("creates and edits a song, a release with its YouTube links, and a tour through proposals", async () => {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  const { client, call, fail, publish } = await connect(publisher, db);
  try {
    // Song: a new one gets a version of the same name without being told to.
    const song = await call<Proposed>("changes.propose_song", {
      song: { title: "only my railgun", original_artist: "fripSide", first_release_date: "2009-11-04", phases: [1], aliases: ["OMR"] },
      source_url: "https://fripside.net/musics/1", reason: "补录", idempotency_key: "catalog-song-create",
    });
    expect(song.change).toMatchObject({ subject_type: "song", operation: "create" });
    const songPreview = await call<ChangePreview>("changes.preview", { change_set_id: song.change.id });
    expect(songPreview.warnings).toEqual([]);
    expect(songPreview.catalog).toMatchObject({ kind: "song", before: null, after: { title: "only my railgun", versions: [{ title: "only my railgun" }] } });
    const { song_id } = await publish<{ song_id: string }>(song.change.id);
    const read = await call<{ song: { updated_at: string; aliases: string[]; phases: number[]; versions: Array<{ version_id: string }>; sources: Array<{ url: string }> } }>("songs.get", { song_id });
    expect(read.song).toMatchObject({ aliases: ["OMR"], phases: [1], sources: [{ url: "https://fripside.net/musics/1" }] });
    const versionId = read.song.versions[0].version_id;

    // Editing sends only what changes; the stored version and aliases stay.
    const edit = await call<Proposed>("changes.propose_song", {
      song_id, expected_updated_at: read.song.updated_at, song: { notes: "TV 动画 OP", versions: [{ title: "only my railgun -version 2020-", version_label: "version 2020" }] },
      reason: "补充", idempotency_key: "catalog-song-edit",
    });
    const editPreview = await call<ChangePreview>("changes.preview", { change_set_id: edit.change.id });
    expect(editPreview.catalog?.before).toMatchObject({ notes: null });
    expect(editPreview.catalog?.after).toMatchObject({ notes: "TV 动画 OP", aliases: ["OMR"], versions: [{ id: versionId }, { version_label: "version 2020" }] });
    expect(await fail("changes.propose_song", {
      song_id, expected_updated_at: "2020-01-01T00:00:00.000Z", song: { notes: "x" }, reason: "过期", idempotency_key: "catalog-song-stale",
    })).toContain("version_conflict");
    await publish(edit.change.id);
    expect((await call<{ song: { versions: unknown[]; notes: string } }>("songs.get", { song_id })).song).toMatchObject({ notes: "TV 动画 OP", versions: [{}, {}] });

    // Release: tracks must point at stored versions.
    expect(await fail("changes.propose_release", {
      release: { title: "only my railgun", release_type: "single", tracks: [{ song_version_id: "missing", track_number: 1, display_title: "only my railgun" }] },
      reason: "补录", idempotency_key: "catalog-release-bad",
    })).toContain("歌曲版本不存在");
    const release = await call<Proposed>("changes.propose_release", {
      release: { title: "only my railgun", release_type: "single", release_date: "2009-11-04", catalog_number: "GNCA-0152",
        tracks: [{ song_version_id: versionId, track_number: 1, display_title: "only my railgun" }] },
      reason: "补录", idempotency_key: "catalog-release-create",
    });
    const { release_id } = await publish<{ release_id: string }>(release.change.id);
    expect((await call<{ count: number }>("releases.search", { query: "GNCA-0152" })).count).toBe(1);
    const stored = await call<{ release: { updated_at: string } }>("releases.get", { release_id });

    // A YouTube link is set on one track without resending the track list; a full URL is stored as its id.
    const link = await call<Proposed>("changes.propose_release", {
      release_id, expected_updated_at: stored.release.updated_at,
      release: { track_links: [{ track_number: 1, youtube_video_id: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }] },
      reason: "补试听链接", idempotency_key: "catalog-release-youtube",
    });
    await publish(link.change.id);
    const linked = await call<{ release: { tracks: Array<{ youtube_video_id: string | null; song_version_id: string }>; catalog_number: string } }>("releases.get", { release_id });
    expect(linked.release).toMatchObject({ catalog_number: "GNCA-0152", tracks: [{ youtube_video_id: "dQw4w9WgXcQ", song_version_id: versionId }] });
    expect(await fail("changes.propose_release", {
      release_id, expected_updated_at: (await call<{ release: { updated_at: string } }>("releases.get", { release_id })).release.updated_at,
      release: { track_links: [{ track_number: 9, youtube_video_id: "dQw4w9WgXcQ" }] }, reason: "错位", idempotency_key: "catalog-release-slot",
    })).toContain("invalid_track");

    // Tour, then an event joins it through an ordinary update proposal.
    const tour = await call<Proposed>("changes.propose_tour", { tour: { name: "fripSide Phase 3 Tour" }, reason: "新巡演", idempotency_key: "catalog-tour-create" });
    const { tour_id } = await publish<{ tour_id: string }>(tour.change.id);
    expect((await call<{ tours: Array<{ tour_id: string }> }>("tours.search", { query: "phase 3" })).tours).toMatchObject([{ tour_id }]);
    const event = await new ContentAdminService(db).saveEvent({ published: true, idempotency_key: "catalog-event", event: {
      title: "fripSide LIVE", start_date: "2026-05-01", timezone: "Asia/Tokyo", category: "LIVE", status: "scheduled",
      location_mode: "none", location_note: null, venues: [], channels: [], sources: [{ url: "https://fripside.net/live" }],
    } }, publisher);
    expect(await fail("changes.propose_update", {
      target_event_id: event.id, expected_version: 1, patch: { tour_id: "missing" }, source_url: "https://fripside.net/live", reason: "错", idempotency_key: "catalog-event-badtour",
    })).toContain("invalid_tour");
    const join = await call<Proposed>("changes.propose_update", {
      target_event_id: event.id, expected_version: 1, patch: { tour_id, tour_stop: "東京公演", alias: "P3 東京" },
      source_url: "https://fripside.net/live", reason: "加入巡演", idempotency_key: "catalog-event-tour",
    });
    await publish(join.change.id);
    const stops = await call<{ tour: { stops: Array<{ event_id: string; tour_stop: string }> } }>("tours.get", { tour_id });
    expect(stops.tour.stops).toMatchObject([{ event_id: event.id, tour_stop: "東京公演" }]);
    expect(sqlite.prepare("SELECT alias, version FROM events WHERE id = ?").get(event.id)).toMatchObject({ alias: "P3 東京", version: 2 });

    const actions = sqlite.prepare("SELECT action FROM audit_logs WHERE action LIKE 'change.publish_%' ORDER BY rowid").all().map((row) => (row as { action: string }).action);
    expect(actions).toEqual(["change.publish_song_create", "change.publish_song_update", "change.publish_release_create", "change.publish_release_update", "change.publish_tour_create", "change.publish_update"]);
    const audit = await call<{ logs: Array<{ action: string }> }>("audit.list", { target_type: "tour" });
    expect(audit.logs.map((log) => log.action)).toContain("content.tour.create");
  } finally { await client.close(); }
});

it("moderates comments directly for a publisher and hides those tools from the chat assistant", async () => {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  sqlite.prepare(`INSERT INTO comments (thread_type, thread_id, author_name, body, status, source_hash, created_at)
    VALUES ('site', 'site', '访客', '你好', 'visible', ?, '2026-01-01T00:00:00.000Z')`).run("a".repeat(32));
  const { client, call } = await connect(publisher, db);
  try {
    const listed = await call<{ comments: Array<{ id: number; status: string }> }>("comments.list", {});
    expect(listed.comments).toMatchObject([{ status: "visible" }]);
    await call("comments.moderate", { action: "hide", comment_id: listed.comments[0].id, confirm: true });
    expect((await call<{ comments: Array<{ status: string }> }>("comments.list", { status: "hidden" })).comments).toHaveLength(1);
    await call("comments.set_blocked_terms", { terms: ["广告"], confirm: true });
    expect((await call<{ blocked_terms: string[] }>("comments.list", {})).blocked_terms).toEqual(["广告"]);
  } finally { await client.close(); }

  const chat = await connect({ id: "chat", type: "ai", channel: "mcp", scopes: [...CHAT_SCOPES] }, db);
  try {
    const names = (await chat.client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["changes.propose_song", "changes.propose_release", "changes.propose_tour", "releases.get"]));
    expect(names.filter((name) => name.startsWith("comments.") || name === "audit.list")).toEqual([]);
  } finally { await chat.client.close(); }
});
