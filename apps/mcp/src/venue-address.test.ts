/// <reference types="node" />
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { Actor, ChangePreview, EventRecord } from "@frip-fan/core";
import { createTestD1 } from "../../../packages/core/src/test-d1";
import { createServer } from "./index";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

const publisher: Actor = { id: "maintainer@example.com", type: "human", channel: "mcp",
  scopes: ["events:read", "events:draft", "events:publish"] };

it("edits a venue address through propose_update, preview and publish", async () => {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  const server = createServer({ DB: db }, publisher);
  const client = new Client({ name: "venue-address-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async <T>(name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError, JSON.stringify(response.structuredContent)).not.toBe(true);
    return (response.structuredContent as { result: T }).result;
  };
  try {
    const tool = (await client.listTools()).tools.find((item) => item.name === "changes.propose_update");
    expect(JSON.stringify(tool?.inputSchema)).toContain("venue_updates");

    const created = await call<{ change: { id: string } }>("changes.propose_create", {
      event: {
        title: "場所テスト", start_date: "2026-12-05", timezone: "Asia/Tokyo", category: "LIVE", status: "scheduled",
        location_mode: "physical", venues: [{ canonical_name: "東京ガーデンシアター" }], channels: [],
        sources: [{ url: "https://fripside.net/venue-address-test" }],
      },
      reason: "新增", idempotency_key: "venue-address-create",
    });
    const { event } = await call<{ event: EventRecord }>("changes.publish", {
      change_set_id: created.change.id, confirm: true, idempotency_key: "venue-address-create-publish",
    });
    const venueId = event.venues[0].id;
    expect(event.venues[0].address_text).toBeNull();

    const proposed = await call<{ change: { id: string } }>("changes.propose_update", {
      target_event_id: event.id, expected_version: event.version,
      patch: { venue_updates: [{ venue_id: venueId, address_text: "東京都江東区有明2-1-6" }] },
      source_url: "https://fripside.net/venue-address-test", reason: "补充场馆地址", idempotency_key: "venue-address-update",
    });
    const preview = await call<ChangePreview>("changes.preview", { change_set_id: proposed.change.id });
    expect(preview.venue_changes).toEqual([{
      venue_id: venueId, canonical_name: "東京ガーデンシアター", before: null, after: "東京都江東区有明2-1-6", other_event_count: 0,
    }]);

    await call("changes.publish", { change_set_id: proposed.change.id, confirm: true, idempotency_key: "venue-address-update-publish" });
    const read = await call<{ event: EventRecord }>("events.get", { event_id: event.id });
    expect(read.event.version).toBe(event.version + 1);
    expect(read.event.venues[0]).toMatchObject({ id: venueId, address_text: "東京都江東区有明2-1-6" });

    const unlinked = await client.callTool({ name: "changes.propose_update", arguments: {
      target_event_id: event.id, expected_version: read.event.version,
      patch: { venue_updates: [{ venue_id: "ven_other", address_text: "x" }] },
      source_url: "https://fripside.net/venue-address-test", reason: "错误场馆", idempotency_key: "venue-address-unlinked",
    } });
    expect(unlinked.isError).toBe(true);
    expect(JSON.stringify(unlinked.structuredContent)).toContain("venue_not_linked");
  } finally { await client.close(); }
});
