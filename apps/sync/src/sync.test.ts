/// <reference types="node" />
import type { DatabaseSync } from "node:sqlite";
import { createTestD1 } from "../../../packages/core/src/test-d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsClient } from "./agent";
import { actionSchema, boundedText, officialUrl, verifyEvidence, actionKey, applyAction } from "@frip-fan/core";
import { tick } from "./index";

const config = { MCP_ENDPOINT_URL: "https://mcp.fripsi.test/mcp", AUTOMATION_SIGNING_SECRET: "test-signing-key-at-least-32-bytes-long", SYNC_DISCOVERY_ENABLED: "false" };
const source = "https://fripside.net/contents/123456";
const quote = "2026年11月20日 fripSideのライブを開催いたします。";
const create = () => actionSchema.parse({
  operation: "create", source_url: source, evidence_quote: quote,
  reason: "公式発表", needs_review: false,
  event: { title: "fripSide test live", start_date: "2026-11-20", category: "LIVE", location_mode: "undisclosed", sources: [{ url: source }] },
});
const databases: DatabaseSync[] = [];
function database() {
  const result = createTestD1();
  databases.push(result.sqlite);
  return result;
}
afterEach(() => { vi.unstubAllGlobals(); for (const db of databases.splice(0)) db.close(); });

describe("official source verification", () => {
  it.each(["http://fripside.net/contents/1", "https://fripside.net.evil.test/contents/1", "https://user@fripside.net/contents/1", "https://fripside.net:444/contents/1", "https://fripside.net/"])("rejects untrusted URL %s", (url) => {
    expect(() => officialUrl(url)).toThrow("untrusted_source");
  });
  it("matches visible quoted text but ignores scripts", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(`<script>${quote}</script><p>not the announcement</p>`, { headers: { "content-type": "text/html" } }));
    expect(await verifyEvidence(source, quote, request)).toBe(false);
    request.mockResolvedValue(new Response(`<p>${quote}</p>`, { headers: { "content-type": "text/html" } }));
    expect(await verifyEvidence(source, quote, request)).toBe(true);
  });
  it("rejects redirects outside the official host before fetching them", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.test/" } }));
    await expect(verifyEvidence(source, quote, request)).rejects.toThrow("untrusted_source");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("bounds remote response memory", async () => {
    await expect(boundedText(new Response("too long"), 2)).rejects.toThrow("response_too_large");
  });
});

describe("automatic publication with the real change service", () => {
  it("publishes once with an audit record and survives replay", async () => {
    const { db, sqlite } = database();
    const verify = vi.fn().mockResolvedValue(true);
    const first = await applyAction(db, create(), [source], true, verify);
    expect(first.status).toBe("published");
    const again = await applyAction(db, create(), [source], true, verify);
    expect(again.status).toBe("unchanged");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM events").get()).toMatchObject({ n: 1 });
    expect(sqlite.prepare("SELECT actor_id FROM audit_logs WHERE action = 'change.publish_create'").get()).toMatchObject({ actor_id: "official-sync-agent" });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it.each(["uncertain", "unverified", "draft"])("leaves %s content for review", async (mode) => {
    const { db, sqlite } = database();
    const action = { ...create(), needs_review: mode === "uncertain" };
    expect((await applyAction(db, action, [source], mode !== "draft", async () => mode !== "unverified")).status).toBe("review");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM events").get()).toMatchObject({ n: 0 });
    expect(sqlite.prepare("SELECT status FROM change_sets").get()).toMatchObject({ status: "proposed" });
  });
  it("blocks duplicate activities even when wording in the proposal changes", async () => {
    const { db, sqlite } = database();
    await applyAction(db, create(), [source], true, async () => true);
    const action = create();
    if (action.operation !== "create") throw new Error("fixture");
    action.event.remark = "New detail";
    expect(await applyAction(db, action, [source], true, async () => true)).toMatchObject({ status: "review", code: "preview_warning" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM events").get()).toMatchObject({ n: 1 });
  });
  it("blocks a stale update and publishes a sourced cancellation", async () => {
    const { db, sqlite } = database();
    const first = await applyAction(db, create(), [source], true, async () => true);
    const change = actionSchema.parse({ operation: "status_change", target_event_id: first.event_id, expected_version: 1, status: "cancelled", source_url: source, evidence_quote: quote, reason: "中止", needs_review: false });
    expect((await applyAction(db, change, [source], true, async () => true)).status).toBe("published");
    const update = actionSchema.parse({ ...change, operation: "update", patch: { start_time: "18:00" } });
    expect(await applyAction(db, update, [source], true, async () => true)).toMatchObject({ status: "blocked", code: "version_conflict" });
    expect(sqlite.prepare("SELECT status, version FROM events").get()).toMatchObject({ status: "cancelled", version: 2 });
  });
  it("requires a source actually read by the agent", async () => {
    const { db } = database();
    expect(await applyAction(db, create(), [], true, async () => true)).toMatchObject({ status: "blocked", code: "source_not_read" });
  });
  it("detects duplicates despite case and punctuation changes", async () => {
    const { db } = database();
    await applyAction(db, create(), [source], true, async () => true);
    const action = create();
    if (action.operation !== "create") throw new Error("fixture");
    action.event.title = "FRIPSIDE TEST LIVE!";
    action.event.sources = [{ url: "https://fripside.net/contents/654321" }];
    action.source_url = action.event.sources[0].url;
    expect(await applyAction(db, action, [action.source_url], true, async () => true)).toMatchObject({ status: "review", code: "normalized_duplicate" });
  });
  it("uses stable fact keys across differences in reason and confidence", async () => {
    expect(await actionKey(create())).toBe(await actionKey({ ...create(), reason: "another reason", needs_review: true }));
  });
});

describe("Agents API and scheduled recovery", () => {
  it("rejects redirects without forwarding the API credential to another destination", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.redirect === "error") throw new TypeError("Invalid redirect value");
      return new Response(null, { status: 302, headers: { location: "https://unrelated.test/" } });
    });
    await expect(new AgentsClient("test-key", request).call("sessions")).rejects.toThrow("openai_http_302");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]?.redirect).toBe("manual");
  });
  it("does not invoke the Workers native fetch with the client as its receiver", async () => {
    vi.stubGlobal("fetch", function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(Response.json({ id: "sess_receiver_test" }));
    });
    expect(await new AgentsClient("test-key").start("test-model", {}, "receiver-test", {
      url: config.MCP_ENDPOINT_URL, authorization: "Bearer test", autoPublish: false,
    })).toBe("sess_receiver_test");
  });
  it("trims copied surrounding whitespace and rejects embedded whitespace before making a request", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }));
    await new AgentsClient("  test-key\n", request).call("sessions");
    expect(request.mock.calls[0][1]?.headers).toMatchObject({ authorization: "Bearer test-key" });
    await expect(new AgentsClient("test\nkey", request).call("sessions")).rejects.toThrow("openai_key_format_invalid");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("connects web search and authenticated MCP with an explicit automatic publish tool", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "sess_test" }));
    await new AgentsClient("test-key", request).start("test-model", { run_id: "test" }, "run-1", { url: config.MCP_ENDPOINT_URL, authorization: "Bearer test", autoPublish: true });
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/agents/sessions");
    expect(init?.headers).toMatchObject({ "OpenAI-Beta": "agents=v1", "Idempotency-Key": "run-1" });
    const tools = JSON.parse(String(init?.body)).agent.tools;
    const schema = JSON.parse(String(init?.body)).agent.text.format.schema;
    expect(schema.properties.source_outcomes.items.properties.source_url).toEqual({ type: "string" });
    expect(tools[0]).toMatchObject({ type: "web_search", allowed_domains: ["fripside.net", "www.fripside.net"] });
    expect(tools[1]).toMatchObject({ type: "mcp", required: true, connection_origin: "service", transport: { server_url: config.MCP_ENDPOINT_URL, authorization: "Bearer test" } });
    expect(tools[1].allowed_tools).toContain("changes.publish_automatic");
    expect(tools[1].allowed_tools).not.toContain("changes.publish");
  });
  it("checks turn completion and ignores commentary or incomplete messages", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "turn_1", status: "in_progress" }] }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "turn_1", status: "completed" }] }))
      .mockResolvedValueOnce(Response.json({ data: [{ type: "message", role: "assistant", status: "completed", phase: "commentary", turn_id: "turn_1", content: [{ type: "output_text", text: "not JSON" }] }] }));
    const client = new AgentsClient("test", request);
    expect(await client.collect("sess_test")).toBeNull();
    await expect(client.collect("sess_test")).rejects.toThrow("agent_output_missing");
  });
  it("starts at most one run per Japan day and completes on a later tick", async () => {
    const { db, sqlite } = database();
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: "sess_test" }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "turn_1", status: "completed" }] }))
      .mockResolvedValueOnce(Response.json({ data: [{ type: "message", role: "assistant", status: "completed", phase: "final_answer", turn_id: "turn_1", content: [{ type: "output_text", text: JSON.stringify({ summary: "No changes", published_change_ids: [], review_change_ids: [], notes: [] }) }] }] }));
    vi.stubGlobal("fetch", request);
    const env = { ...config, DB: db, SYNC_ENABLED: "true", OPENAI_API_KEY: "test", OPENAI_MODEL: "gpt-6-luna" };
    await tick(env, new Date("2026-10-29T10:00:00Z"));
    await tick(env, new Date("2026-10-29T10:05:00Z"));
    await tick(env, new Date("2026-10-29T10:10:00Z"));
    await tick(env, new Date("2026-10-29T14:55:00Z"));
    expect(request).toHaveBeenCalledTimes(3);
    expect(sqlite.prepare("SELECT status FROM official_sync_runs").get()).toMatchObject({ status: "completed" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM official_sync_runs").get()).toMatchObject({ n: 1 });
  });
  it("does nothing when disabled or when another tick owns the lease", async () => {
    const { db, sqlite } = database();
    const request = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", request);
    await tick({ DB: db });
    sqlite.prepare("INSERT INTO official_sync_lease VALUES (1, 'other', ?)").run(Date.now() + 900_000);
    await tick({ ...config, DB: db, SYNC_ENABLED: "true", OPENAI_API_KEY: "test", OPENAI_MODEL: "gpt-6-luna" });
    expect(request).not.toHaveBeenCalled();
  });
  it("retries a lost create response with the identical saved input and key", async () => {
    const { db, sqlite } = database();
    const request = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network failure with sensitive details"))
      .mockResolvedValueOnce(Response.json({ id: "sess_recovered" }));
    vi.stubGlobal("fetch", request);
    const env = { ...config, DB: db, SYNC_ENABLED: "true", OPENAI_API_KEY: "test", OPENAI_MODEL: "gpt-6-luna" };
    await expect(tick(env, new Date("2026-10-29T10:00:00Z"))).rejects.toThrow("sync_step_failed");
    expect(sqlite.prepare("SELECT error_code FROM official_sync_runs").get()).toMatchObject({ error_code: "sync_step_failed" });
    await tick({ ...env, OPENAI_MODEL: "gpt-6.1-sol" }, new Date("2026-10-29T10:05:00Z"));
    expect(request.mock.calls[1][1]?.body).toBe(request.mock.calls[0][1]?.body);
    expect(request.mock.calls[1][1]?.headers).toEqual(request.mock.calls[0][1]?.headers);
    expect(sqlite.prepare("SELECT session_id, status FROM official_sync_runs").get()).toMatchObject({ session_id: "sess_recovered", status: "running" });
  });
  it("never applies output from a failed turn", async () => {
    const { db, sqlite } = database();
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: "sess_failed" }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "turn_1", status: "failed" }] }))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal("fetch", request);
    const env = { ...config, DB: db, SYNC_ENABLED: "true", OPENAI_API_KEY: "test", OPENAI_MODEL: "gpt-6-luna" };
    await tick(env, new Date("2026-10-29T10:00:00Z"));
    await expect(tick(env, new Date("2026-10-29T10:05:00Z"))).rejects.toThrow("agent_turn_failed");
    expect(sqlite.prepare("SELECT status FROM official_sync_runs").get()).toMatchObject({ status: "failed" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM events").get()).toMatchObject({ n: 0 });
  });
});
