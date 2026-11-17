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
  const client = new Client({ name: "setlist-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async <T>(name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError, JSON.stringify(response.structuredContent)).not.toBe(true);
    return (response.structuredContent as { result: T }).result;
  };
  return { client, call };
}

it("finds songs and setlists, then proposes, previews and publishes a setlist", async () => {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  const now = "2026-01-01T00:00:00.000Z";
  sqlite.prepare("INSERT INTO songs (id, slug, title, normalized_title, created_at, updated_at) VALUES ('song-a', 'song-a', 'only my railgun', 'only my railgun', ?, ?)").run(now, now);
  sqlite.prepare("INSERT INTO song_aliases (id, song_id, alias, normalized_alias, created_at) VALUES ('alias-a', 'song-a', 'OMR', 'omr', ?)").run(now);
  sqlite.prepare("INSERT INTO song_versions (id, song_id, slug, title, version_label, created_at, updated_at) VALUES ('ver-a', 'song-a', 'ver-a', 'only my railgun -version 2020-', 'version 2020', ?, ?)").run(now, now);
  const event = await new ContentAdminService(db).saveEvent({ published: true, idempotency_key: "mcp-setlist-event", event: {
    title: "fripSide LIVE", start_date: "2026-05-01", timezone: "Asia/Tokyo", category: "LIVE", status: "scheduled",
    location_mode: "none", location_note: null, venues: [], channels: [], sources: [{ url: "https://fripside.net/live" }],
  } }, publisher);

  const { client, call } = await connect(publisher, db);
  try {
    const { songs } = await call<{ songs: Array<{ song_id: string; aliases: string[]; versions: Array<{ version_id: string }> }> }>("songs.search", { query: "railgun" });
    expect(songs).toMatchObject([{ song_id: "song-a", aliases: ["OMR"], versions: [{ version_id: "ver-a" }] }]);
    expect((await call<{ count: number }>("setlists.search", { event_id: event.id })).count).toBe(0);

    const proposed = await call<{ change: { id: string } }>("changes.propose_setlist", {
      event_id: event.id, source_url: "https://fripside.net/report", reason: "现场记录", idempotency_key: "mcp-setlist-create",
      setlist: { completeness: "complete", confidence: "reported", entries: [{ song_id: "song-a", performed_version_id: "ver-a" }] },
    });
    const preview = await call<ChangePreview>("changes.preview", { change_set_id: proposed.change.id });
    expect(preview.setlist?.after.entries).toMatchObject([{ position: 1, display_title: "only my railgun -version 2020-" }]);
    const pending = await call<{ pending_changes: Array<{ id: string; subject_type: string }> }>("events.get", { event_id: event.id });
    expect(pending.pending_changes).toMatchObject([{ id: proposed.change.id, subject_type: "setlist" }]);

    const published = await call<{ setlist_id: string; public_url: string }>("changes.publish", {
      change_set_id: proposed.change.id, confirm: true, idempotency_key: "mcp-setlist-publish",
    });
    expect(published.public_url).toBe(`https://fripsi.example/music/lives/${published.setlist_id}`);

    const found = await call<{ setlists: Array<{ setlist_id: string; entry_count: number }> }>("setlists.search", { event_id: event.id });
    expect(found.setlists).toMatchObject([{ setlist_id: published.setlist_id, entry_count: 1 }]);
    expect((await call<{ count: number }>("setlists.search", { query: "railgun" })).count).toBe(1);
    const read = await call<{ setlist: { updated_at: string; entries: Array<{ song_id: string }>; sources: Array<{ url: string }> }; pending_changes: unknown[] }>("setlists.get", { setlist_id: published.setlist_id });
    expect(read.setlist.entries).toMatchObject([{ song_id: "song-a", performed_version_id: "ver-a" }]);
    expect(read.setlist.sources).toMatchObject([{ url: "https://fripside.net/report" }]);
    expect(read.pending_changes).toEqual([]);

    const stale = await client.callTool({ name: "changes.propose_setlist", arguments: {
      setlist_id: published.setlist_id, expected_updated_at: "2020-01-01T00:00:00.000Z", source_url: "https://fripside.net/report",
      reason: "过期", idempotency_key: "mcp-setlist-stale", setlist: { completeness: "complete", confidence: "reported", entries: [] },
    } });
    expect(stale.isError).toBe(true);
    expect(JSON.stringify(stale.structuredContent)).toContain("version_conflict");
  } finally { await client.close(); }
});

it("lets the chat identity read and propose setlists but hides them from the official sync", async () => {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  const chat = await connect({ id: "maintainer@example.com", type: "ai", channel: "mcp", chat_session_id: "chat-1", scopes: [...CHAT_SCOPES] }, db);
  try {
    const names = (await chat.client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["songs.search", "setlists.search", "setlists.get", "changes.propose_setlist"]));
    expect((await chat.call<{ count: number }>("songs.search", { query: "nothing" })).count).toBe(0);
  } finally { await chat.client.close(); }
});
