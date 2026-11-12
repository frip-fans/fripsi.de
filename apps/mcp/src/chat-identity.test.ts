/// <reference types="node" />
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { CHAT_SCOPES, type Actor } from "@frip-fan/core";
import { createTestD1 } from "../../../packages/core/src/test-d1";
import { createServer } from "./index";

const databases: DatabaseSync[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const db of databases.splice(0)) db.close(); });

/** The admin chat credential resolves to exactly these scopes. */
const chatActor: Actor = { id: "maintainer@example.com", type: "ai", channel: "mcp",
  chat_session_id: "chat-session-1", scopes: [...CHAT_SCOPES] };

async function connect(actor: Actor) {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  const server = createServer({ DB: db }, actor);
  const client = new Client({ name: "chat-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, db };
}

it("lets the chat identity propose and preview but never publish", async () => {
  const { client } = await connect(chatActor);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("changes.propose_create");
    expect(names).toContain("changes.preview");
    // The automation-only tools stay hidden from a maintainer-delegated identity.
    expect(names).not.toContain("changes.publish_automatic");
    expect(names).not.toContain("sync.propose");

    const proposed = await client.callTool({ name: "changes.propose_create", arguments: {
      event: {
        title: "テストイベント", start_date: "2026-12-05", timezone: "Asia/Tokyo",
        category: "LIVE", status: "scheduled", location_mode: "online", venues: [],
        channels: [{ channel_type: "streaming", name: "YouTube", url: "https://www.youtube.com/" }],
        sources: [{ url: "https://fripside.net/chat-test" }],
      },
      reason: "维护者在聊天里要求新增",
      idempotency_key: "chat-propose-create-1",
    } });
    expect(proposed.isError).not.toBe(true);
    const change = (proposed.structuredContent as { result?: { change?: { id?: string } } }).result?.change;
    expect(change?.id).toBeTruthy();

    expect((await client.callTool({ name: "changes.preview", arguments: { change_set_id: change!.id } })).isError).not.toBe(true);

    // changes.publish is registered for human identities, so the scope check is what
    // must stop a stolen or widened chat credential from publishing.
    const published = await client.callTool({ name: "changes.publish", arguments: {
      change_set_id: change!.id, confirm: true, idempotency_key: "chat-publish-attempt-1",
    } });
    expect(published.isError).toBe(true);
    expect(JSON.stringify(published.structuredContent)).toContain("events:publish");
  } finally { await client.close(); }
});

it("stamps the originating chat session on the proposal", async () => {
  const { client, db } = await connect(chatActor);
  try {
    const proposed = await client.callTool({ name: "changes.propose_create", arguments: {
      event: {
        title: "テスト 2", start_date: "2026-12-06", timezone: "Asia/Tokyo",
        category: "LIVE", status: "scheduled", location_mode: "online", venues: [],
        channels: [{ channel_type: "streaming", name: "YouTube", url: "https://www.youtube.com/" }],
        sources: [{ url: "https://fripside.net/chat-test-2" }],
      },
      reason: "归属测试", idempotency_key: "chat-propose-create-2",
    } });
    const change = (proposed.structuredContent as { result?: { change?: { id?: string } } }).result?.change;
    const row = await db.prepare("SELECT chat_session_id FROM change_sets WHERE id=?")
      .bind(change!.id).first<{ chat_session_id: string | null }>();
    // Without this the dock would attribute proposals by creation time and misfile
    // every one of them as soon as two sessions overlap.
    expect(row?.chat_session_id).toBe("chat-session-1");
  } finally { await client.close(); }
});

it("refuses archive and unpublish proposals from the chat identity", async () => {
  const { client } = await connect(chatActor);
  try {
    for (const name of ["changes.propose_archive", "changes.propose_unpublish"]) {
      const result = await client.callTool({ name, arguments: {
        target_event_id: "missing", expected_version: 1, reason: "测试", idempotency_key: `chat-${name}-1`,
      } });
      expect(result.isError).toBe(true);
    }
  } finally { await client.close(); }
});
