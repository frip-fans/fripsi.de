/// <reference types="node" />
import { z } from "zod";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createTestD1 } from "../../../packages/core/src/test-d1";
import { createServer } from "./index";
import type { Actor } from "@frip-fan/core";

const databases: DatabaseSync[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const db of databases.splice(0)) db.close(); });

it("runs search, propose, preview and direct publication through the real MCP protocol", async () => {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  const now = new Date().toISOString();
  sqlite.prepare("INSERT INTO official_sync_runs (id, status, auto_publish, created_at, updated_at) VALUES ('run', 'running', 1, ?, ?)").run(now, now);
  const actor: Actor = { id: "official-sync-agent", type: "ai", channel: "mcp", automation_run_id: "run", scopes: ["events:read", "events:draft", "events:publish", "events:auto_publish"] };
  const server = createServer({ DB: db }, actor);
  const client = new Client({ name: "test-agent", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("changes.publish_automatic");
    expect(names).not.toContain("changes.publish");
    expect(names).not.toContain("changes.propose_archive");
    expect((await client.callTool({ name: "events.search", arguments: { query: "test" } })).isError).not.toBe(true);
    const quote = "2026年11月20日 fripSideのライブを開催いたします。";
    const proposed = await client.callTool({ name: "sync.propose", arguments: { action: {
      operation: "create", source_url: "https://fripside.net/contents/123456", reason: "official", evidence_quote: quote, needs_review: false,
      event: { title: "MCP direct publication", start_date: "2026-11-20", category: "LIVE", location_mode: "undisclosed", sources: [{ url: "https://fripside.net/contents/123456" }] },
    } } });
    expect(proposed.isError).not.toBe(true);
    const changeId = z.object({ result: z.object({ change_id: z.string() }) }).parse(proposed.structuredContent).result.change_id;
    const preview = await client.callTool({ name: "changes.preview", arguments: { change_set_id: changeId } });
    const digest = z.object({ result: z.object({ preview_digest: z.string() }) }).parse(preview.structuredContent).result.preview_digest;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`<p>${quote}</p>`, { headers: { "content-type": "text/html" } })));
    const published = await client.callTool({ name: "changes.publish_automatic", arguments: { change_set_id: changeId, preview_digest: digest } });
    expect(published.isError).not.toBe(true);
    expect(published.structuredContent).toMatchObject({ result: { status: "published" } });
    expect(sqlite.prepare("SELECT published FROM events").get()).toMatchObject({ published: 1 });
  } finally { await client.close(); await server.close(); }
});

it("keeps ordinary clients on the per-publication confirmation flow", async () => {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  const server = createServer({ DB: db }, { id: "editor", type: "ai", channel: "mcp", scopes: ["events:read", "events:draft", "events:publish"] });
  const client = new Client({ name: "test-editor", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("changes.publish");
    expect(names).not.toContain("changes.publish_automatic");
    expect(names).not.toContain("sync.propose");
  } finally { await client.close(); await server.close(); }
});

it("gives the setlist collection task only its own tools, through the real MCP protocol", async () => {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  const now = new Date().toISOString();
  sqlite.prepare("INSERT INTO songs (id, slug, title, normalized_title, created_at, updated_at) VALUES ('song-a', 'song-a', 'only my railgun', 'only my railgun', ?, ?)").run(now, now);
  sqlite.prepare("INSERT INTO official_sync_runs (id, status, auto_publish, policy_version, input_json, created_at, updated_at) VALUES ('setlists-run', 'running', 1, 'setlist-sync-v1', ?, ?, ?)")
    .run(JSON.stringify({ kind: "setlists", input: { events: [] } }), now, now);
  const actor: Actor = { id: "official-sync-agent", type: "ai", channel: "mcp", automation_run_id: "setlists-run", automation_kind: "setlists",
    scopes: ["events:read", "events:draft", "music:write", "events:publish", "events:auto_publish"] };
  const server = createServer({ DB: db }, actor);
  const client = new Client({ name: "test-agent", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name).sort())
      .toEqual(["changes.preview", "changes.publish_automatic", "sync.create_song", "sync.find_songs", "sync.propose_setlist"]);
    const found = z.object({ result: z.object({ exists: z.boolean(), matches: z.array(z.object({ song_id: z.string() })) }) })
      .parse((await client.callTool({ name: "sync.find_songs", arguments: { query: "Only My Railgun" } })).structuredContent);
    expect(found.result).toMatchObject({ exists: true, matches: [{ song_id: "song-a" }] });
    const duplicate = await client.callTool({ name: "sync.create_song", arguments: { title: "only my railgun", original_artist: "fripSide", source_url: "https://example.com/setlist", reason: "test" } });
    expect(duplicate.isError).toBe(true);
    expect(JSON.stringify(duplicate.structuredContent)).toContain("duplicate_song");
    // No event belongs to this run, so no setlist can be proposed.
    const refused = await client.callTool({ name: "sync.propose_setlist", arguments: { event_id: "evt-other", completeness: "complete", entries: [{ song_id: "song-a" }], source_url: "https://example.com/setlist", reason: "test" } });
    expect(JSON.stringify(refused.structuredContent)).toContain("forbidden");
  } finally { await client.close(); await server.close(); }
});
