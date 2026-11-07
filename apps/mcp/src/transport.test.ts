/// <reference types="node" />
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createTestD1 } from "../../../packages/core/src/test-d1";
import worker from "./index";

const databases: DatabaseSync[] = [];
const pending: Promise<unknown>[] = [];
const context = {
  waitUntil(promise: Promise<unknown>) { pending.push(promise); },
  passThroughOnException() {},
  props: {},
} as ExecutionContext;

afterEach(async () => {
  await Promise.allSettled(pending.splice(0));
  for (const sqlite of databases.splice(0)) sqlite.close();
});

function fixture(bypass = true) {
  const { db, sqlite } = createTestD1();
  databases.push(sqlite);
  const env = { DB: db, DEV_AUTH_BYPASS: bypass ? "true" : "false" };
  const request: typeof fetch = (input, init) => {
    const req = new Request(input, init);
    // A real HTTP server supplies Host; in-process Request construction does not.
    if (!req.headers.has("host")) req.headers.set("host", new URL(req.url).host);
    return worker.fetch(req, env, context);
  };
  const rpc = (method: string, params: unknown, extraHeaders: Record<string, string> = {}) => request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-03-26",
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { request, rpc, sqlite };
}

async function message(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return response.json();
  for (const event of (await response.text()).split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) continue;
    const parsed = JSON.parse(data);
    if (parsed.id === 1) return parsed;
  }
  throw new Error("MCP stream did not contain the response");
}

it("requires authentication before serving MCP requests", async () => {
  const { rpc } = fixture(false);
  const response = await rpc("tools/list", {});
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource");
});

it("serves legacy stateless clients through the real v2 HTTP handler", async () => {
  const { rpc } = fixture();
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "legacy-client", version: "1" },
  });
  expect(initialized.status).toBe(200);
  expect(await message(initialized)).toMatchObject({ result: { protocolVersion: "2025-03-26" } });

  const listed = await rpc("tools/list", {});
  expect(listed.status).toBe(200);
  const tools = await message(listed) as { result: { tools: Array<{ name: string }> } };
  expect(tools.result.tools.map((tool) => tool.name)).toContain("events.search");
  const searched = await rpc("tools/call", { name: "events.search", arguments: { query: "test" } });
  expect(await message(searched)).toMatchObject({ result: { structuredContent: { result: { events: [], count: 0 } } } });
});

it("connects a v2 client and executes a tool over the real HTTP handler", async () => {
  const { request } = fixture();
  const client = new Client({ name: "v2-client", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { fetch: request });
  await client.connect(transport);
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("events.search");
    expect(client.getDiscoverResult()).toBeDefined();
    expect((await client.callTool({ name: "events.search", arguments: { query: "test" } })).structuredContent)
      .toMatchObject({ result: { events: [], count: 0 } });
  } finally { await client.close(); }
});

it("rejects untrusted browser origins even for authenticated requests", async () => {
  const { rpc } = fixture();
  const response = await rpc("tools/list", {}, { origin: "https://untrusted.example" });
  expect(response.status).toBe(403);
});

it("does not publish an ordinary client's change without explicit confirmation", async () => {
  const { rpc, sqlite } = fixture();
  const response = await rpc("tools/call", {
    name: "changes.publish",
    arguments: { change_set_id: "missing", idempotency_key: "test-unconfirmed", confirm: false },
  });
  const payload = await message(response) as { result?: { isError?: boolean }; error?: { code: number } };
  expect(payload.result?.isError === true || payload.error?.code === -32602).toBe(true);
  expect(JSON.stringify(payload)).toContain("confirm");
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM events").get()).toMatchObject({ count: 0 });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs").get()).toMatchObject({ count: 0 });
});

it("rejects untrusted Host headers before dispatching tools", async () => {
  const { rpc } = fixture();
  expect((await rpc("tools/list", {}, { host: "untrusted.example" })).status).toBe(403);
});
