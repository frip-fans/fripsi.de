/// <reference types="node" />
import { afterEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { ChangeService, type Actor } from "@frip-fan/core";
import { createTestD1 } from "../../../packages/core/src/test-d1";
import worker from "./index";
import { safeTickNotifications, tickNotifications, type BarkEnv } from "./notifications";

const databases: DatabaseSync[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const database of databases.splice(0)) database.close(); });
const initial = new Date("2026-10-31T00:00:00Z");
const later = new Date(initial.valueOf() + 1000);
const actor: Actor = { id: "test-publisher", type: "ai", channel: "mcp", scopes: ["events:read", "events:draft", "events:publish"] };
function setup() {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ code: 200 }));
  const env: BarkEnv = { DB: db, BARK_ENABLED: "true", BARK_DEVICE_KEY: "test-device-key-only", BARK_SITE_URL: "https://fripsi.de" };
  const changes = new ChangeService(db);
  function run(id: string, status = "completed", time = later) {
    sqlite.prepare("INSERT INTO official_sync_runs(id,status,auto_publish,created_at,updated_at) VALUES (?,?,1,?,?)").run(id, status, time.toISOString(), time.toISOString());
  }
  async function change(runId: string, name: string, publish = true) {
    const proposal = await changes.proposeCreate({ event: { title: name, start_date: "2026-11-24", category: "MEDIA", location_mode: "online", channels: [{ channel_type: "streaming", name: "freakSide" }], sources: [{ url: "https://fripside.net/contents/1123461" }] }, reason: "fixture", idempotency_key: `create-fixture:${name}` }, actor);
    sqlite.prepare("INSERT INTO official_sync_changes(run_id,change_id,action_json,created_at) VALUES (?,?,'{}',?)").run(runId, proposal.id, later.toISOString());
    const event = publish ? await changes.publish(proposal.id, actor, `publish:${name}`) : null;
    return { proposal, event };
  }
  return { db, sqlite, env, request, changes, run, change };
}

it("diagnoses a pasted URL without exposing the device credential or throwing into sync", async () => {
  const t = setup(), secret = "https://api.day.app/private-device-key";
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await safeTickNotifications({ ...t.env, BARK_DEVICE_KEY: secret });
    expect(log.mock.calls.flat().join(" ")).toContain("bark_configuration_invalid");
    expect(log.mock.calls.flat().join(" ")).not.toContain(secret);
  } finally { log.mockRestore(); }
});

it("stays silent when disabled or missing a key, and skips historical tasks on activation", async () => {
  const t = setup(); t.run("history", "failed", new Date(initial.valueOf() - 1000));
  await tickNotifications({ ...t.env, BARK_ENABLED: "false" }, initial, t.request);
  await tickNotifications({ ...t.env, BARK_DEVICE_KEY: undefined }, initial, t.request);
  expect(t.sqlite.prepare("SELECT COUNT(*) AS n FROM official_sync_notification_state").get()).toMatchObject({ n: 0 });
  await tickNotifications(t.env, initial, t.request);
  expect(t.request).not.toHaveBeenCalled();
  expect(t.sqlite.prepare("SELECT COUNT(*) AS n FROM official_sync_notifications").get()).toMatchObject({ n: 0 });
});

it("batches only real publications, ignores draft/model claims, and sends once", async () => {
  const t = setup(); await tickNotifications(t.env, initial, t.request); t.run("current");
  await t.change("current", "Published A"); await t.change("current", "Published B"); await t.change("current", "Draft C", false);
  t.sqlite.prepare("UPDATE official_sync_runs SET result_json=? WHERE id='current'").run(JSON.stringify({ published_change_ids: ["invented"], summary: "100 published" }));
  await tickNotifications(t.env, later, t.request); await tickNotifications(t.env, later, t.request);
  expect(t.request).toHaveBeenCalledTimes(1);
  const [url, options] = t.request.mock.calls[0], payload = JSON.parse(String(options?.body));
  expect(url).toBe("https://api.day.app/push"); expect(options?.redirect).toBe("manual");
  expect(payload.body).toContain("新增 2 条，更新 0 条"); expect(payload.body).not.toContain("Draft C"); expect(payload.body).not.toContain("100 published");
  expect(payload.body).toContain("https://fripsi.de/events/"); expect(payload.device_key).toBe(t.env.BARK_DEVICE_KEY);
  expect(payload.icon).toBe("https://fripsi.de/bark-icon-v1.png");
  const row = t.sqlite.prepare("SELECT status,payload_json FROM official_sync_notifications").get() as { status: string; payload_json: string };
  expect(row.status).toBe("sent"); expect(row.payload_json).not.toContain(t.env.BARK_DEVICE_KEY);
});

it("coalesces multiple published revisions of the same event", async () => {
  const t = setup(); await tickNotifications(t.env, initial, t.request); t.run("current");
  const { event } = await t.change("current", "A");
  const update = await t.changes.proposeUpdate({ target_event_id: event!.id, expected_version: 1, patch: { start_time: "20:30" }, source_url: "https://fripside.net/contents/1123461", reason: "time supplied", idempotency_key: "update:A" }, actor);
  await t.changes.publish(update.id, actor, "publish:update:A");
  t.sqlite.prepare("INSERT INTO official_sync_changes(run_id,change_id,action_json,created_at) VALUES ('current',?,'{}',?)").run(update.id, later.toISOString());
  await tickNotifications(t.env, later, t.request);
  const payload = JSON.parse(String(t.request.mock.calls[0][1]?.body));
  expect(payload.body).toContain("新增 1 条，更新 0 条");
});

it("remains silent for no-op and draft-only results without starving later updates", async () => {
  const t = setup(); await tickNotifications(t.env, initial, t.request); t.run("empty"); t.run("draft");
  await t.change("draft", "Draft only", false); await tickNotifications(t.env, later, t.request);
  expect(t.request).not.toHaveBeenCalled();
  expect(t.sqlite.prepare("SELECT COUNT(*) AS n FROM official_sync_notifications WHERE status='skipped'").get()).toMatchObject({ n: 2 });
  t.run("actual"); await t.change("actual", "Actual"); await tickNotifications(t.env, later, t.request);
  expect(t.request).toHaveBeenCalledTimes(1);
});

it("retries HTTP and business errors with backoff without replaying publications", async () => {
  const t = setup(); await tickNotifications(t.env, initial, t.request); t.run("current"); await t.change("current", "A");
  t.request.mockReset().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json({ code: 400 })).mockImplementation(async () => Response.json({ code: 200 }));
  await tickNotifications(t.env, later, t.request); await tickNotifications(t.env, new Date(later.valueOf() + 1000), t.request);
  expect(t.request).toHaveBeenCalledTimes(1);
  await tickNotifications(t.env, new Date(later.valueOf() + 300000), t.request);
  expect(t.sqlite.prepare("SELECT attempts,last_error_code FROM official_sync_notifications").get()).toMatchObject({ attempts: 2, last_error_code: "bark_rejected" });
  await tickNotifications(t.env, new Date(later.valueOf() + 900000), t.request);
  expect(t.sqlite.prepare("SELECT status,attempts FROM official_sync_notifications").get()).toMatchObject({ status: "sent", attempts: 3 });
  expect(t.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get()).toMatchObject({ n: 1 });
});

it("leases concurrent deliveries and recovers an interrupted sender", async () => {
  const t = setup(); await tickNotifications(t.env, initial, t.request); t.run("current"); await t.change("current", "A");
  await Promise.all([tickNotifications(t.env, later, t.request), tickNotifications(t.env, later, t.request)]);
  expect(t.request).toHaveBeenCalledTimes(1);
  t.sqlite.prepare("UPDATE official_sync_notifications SET status='sending',claim_id='crashed',locked_until=?,available_at=0").run(later.valueOf() + 60000);
  await tickNotifications(t.env, new Date(later.valueOf() + 59000), t.request); expect(t.request).toHaveBeenCalledTimes(1);
  await tickNotifications(t.env, new Date(later.valueOf() + 60000), t.request); expect(t.request).toHaveBeenCalledTimes(2);
});

it("reports partial publications and terminal errors without exposing raw provider messages", async () => {
  const t = setup(); await tickNotifications(t.env, initial, t.request); t.run("failed", "failed"); await t.change("failed", "Published A");
  t.sqlite.prepare("UPDATE official_sync_runs SET error_code=? WHERE id='failed'").run("sensitive error containing device key");
  await tickNotifications(t.env, later, t.request);
  const payload = JSON.parse(String(t.request.mock.calls[0][1]?.body));
  expect(payload.title).toContain("同步异常"); expect(payload.body).toContain("新增 1 条"); expect(payload.body).not.toContain("sensitive");
});

it("notifies about unresolved automatic review, without calling OpenAI", async () => {
  const t = setup(); await tickNotifications(t.env, initial, t.request); t.run("review");
  const { proposal } = await t.change("review", "Needs facts", false);
  t.sqlite.prepare("INSERT INTO official_sync_reviews(run_id,change_id,reason,status) VALUES ('review',?,'missing date','unresolved')").run(proposal.id);
  await tickNotifications(t.env, later, t.request);
  const payload = JSON.parse(String(t.request.mock.calls[0][1]?.body));
  expect(payload.body).toContain("仍有事项待核实"); expect(payload.url).toBe("https://fripsi.de/admin/changes");
});

it("drains notifications when sync is disabled and missing OpenAI configuration", async () => {
  const t = setup(); await tickNotifications(t.env, initial, t.request); t.run("failed", "failed", new Date());
  vi.stubGlobal("fetch", t.request);
  const tasks: Promise<unknown>[] = [];
  await worker.scheduled({} as ScheduledController, { ...t.env, SYNC_ENABLED: "false" }, { waitUntil: (task: Promise<unknown>) => tasks.push(task) } as unknown as ExecutionContext);
  await Promise.all(tasks);
  expect(t.request).toHaveBeenCalledTimes(1);
  expect(t.request.mock.calls[0][0]).toBe("https://api.day.app/push");
});
