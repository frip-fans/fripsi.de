/// <reference types="node" />
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createTestD1 } from "../../../packages/core/src/test-d1";
import { createServer } from "./index";
import type { Actor } from "@frip-fan/core";

vi.mock("agents/mcp", () => ({ createMcpHandler: vi.fn() }));
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
