/// <reference types="node" />
import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { AutomationService } from "./automation-service";
import { authenticateMcp } from "./auth";
import { authenticateAutomationToken, signAutomationToken } from "./automation-auth";
import { actionSchema } from "./official-sync-schema";
import { createTestD1 } from "./test-d1";
import type { Actor } from "./types";

const signingSecret = "unit-test-signing-key-not-a-real-secret";
const audience = "https://mcp.fripsi.test/mcp";
const runId = "official-test";
const databases: DatabaseSync[] = [];
function setup(autoPublish = true) {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  const createdAt = new Date().toISOString();
  sqlite.prepare("INSERT INTO official_sync_runs (id, status, auto_publish, created_at, updated_at) VALUES (?, 'running', ?, ?, ?)").run(runId, autoPublish ? 1 : 0, createdAt, createdAt);
  const actor: Actor = { id: "official-sync-agent", type: "ai", channel: "mcp", automation_run_id: runId, automation_role: "primary",
    scopes: ["events:read", "events:draft", ...(autoPublish ? ["events:publish", "events:auto_publish"] : [])] };
  const action = actionSchema.parse({ operation: "create", source_url: "https://fripside.net/contents/123456", reason: "official news", needs_review: false,
    evidence_quote: "2026年11月20日 fripSideのライブを開催いたします。",
    event: { title: "fripSide automatic test", start_date: "2026-11-20", category: "LIVE", location_mode: "undisclosed", sources: [{ url: "https://fripside.net/contents/123456" }] } });
  const env = { DB: db, AUTOMATION_SIGNING_SECRET: signingSecret, AUTOMATION_AUDIENCE: audience };
  return { db, sqlite, actor, action, env, createdAt, service: new AutomationService(db, async () => true) };
}
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe("automatic MCP identity", () => {
  it("authenticates a short-lived task identity even with local development bypass enabled", async () => {
    const { env, createdAt, actor } = setup();
    const token = await signAutomationToken(signingSecret, audience, runId, createdAt);
    const request = new Request(audience, { headers: { Authorization: `Bearer ${token}` } });
    expect(await authenticateMcp(request, { ...env, DEV_AUTH_BYPASS: "true" })).toEqual(actor);
    expect(actor.scopes).not.toContain("events:archive");
  });
  it("gives a draft-only task no publishing permission", async () => {
    const { env, createdAt } = setup(false);
    const token = await signAutomationToken(signingSecret, audience, runId, createdAt);
    expect((await authenticateAutomationToken(token, env)).scopes).toEqual(["events:read", "events:draft"]);
  });
  it("rejects wrong audience, wrong signature, expired credentials and closed tasks", async () => {
    const { env, sqlite, createdAt } = setup();
    const valid = await signAutomationToken(signingSecret, audience, runId, createdAt);
    await expect(authenticateAutomationToken(valid, { ...env, AUTOMATION_AUDIENCE: "https://other.test/mcp" })).rejects.toMatchObject({ status: 401 });
    await expect(authenticateAutomationToken(valid, { ...env, AUTOMATION_SIGNING_SECRET: signingSecret + "wrong" })).rejects.toMatchObject({ status: 401 });
    const expired = await signAutomationToken(signingSecret, audience, runId, new Date(Date.now() - 7_200_000).toISOString());
    await expect(authenticateAutomationToken(expired, env)).rejects.toMatchObject({ status: 401 });
    sqlite.prepare("UPDATE official_sync_runs SET status = 'completed'").run();
    await expect(authenticateAutomationToken(valid, env)).rejects.toMatchObject({ status: 401 });
  });
  it("does not treat an ordinary MCP identity as an automation identity", async () => {
    const { service, actor, action } = setup();
    await expect(service.propose(action, { ...actor, automation_run_id: undefined })).rejects.toMatchObject({ status: 403 });
    await expect(signAutomationToken("short", audience, runId, new Date().toISOString())).rejects.toMatchObject({ code: "automation_config" });
  });
});

describe("direct agent publication", () => {
  it("requires preview and publishes without a user confirmation flag, with an MCP audit", async () => {
    const { service, actor, action, sqlite } = setup();
    const proposed = await service.propose(action, actor);
    expect(proposed.change_id).toBeTruthy();
    await expect(service.publish(proposed.change_id!, "a".repeat(64), actor)).rejects.toMatchObject({ code: "preview_required" });
    const preview = await service.preview(proposed.change_id!, actor);
    const result = await service.publish(proposed.change_id!, preview.preview_digest, actor);
    expect(result.status).toBe("published");
    expect((await service.publish(proposed.change_id!, preview.preview_digest, actor)).status).toBe("unchanged");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM events").get()).toMatchObject({ n: 1 });
    expect(sqlite.prepare("SELECT actor_id, channel FROM audit_logs WHERE action = 'change.publish_create'").get())
      .toMatchObject({ actor_id: "official-sync-agent", channel: "mcp" });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("prevents publishing another task's proposal", async () => {
    const { service, actor, action, sqlite } = setup();
    const proposed = await service.propose(action, actor);
    const timestamp = new Date().toISOString();
    sqlite.prepare("UPDATE official_sync_runs SET status = 'completed'").run();
    sqlite.prepare("INSERT INTO official_sync_runs (id, status, auto_publish, created_at, updated_at) VALUES ('other', 'running', 1, ?, ?)").run(timestamp, timestamp);
    await expect(service.preview(proposed.change_id!, { ...actor, automation_run_id: "other" })).rejects.toMatchObject({ status: 403 });
  });
  it("keeps uncertain or unverified facts as proposals", async () => {
    const { service, db, actor, action, sqlite } = setup();
    const proposed = await service.propose({ ...action, needs_review: true }, actor);
    const preview = await service.preview(proposed.change_id!, actor);
    expect(await service.publish(proposed.change_id!, preview.preview_digest, actor)).toMatchObject({ status: "review", code: "uncertain" });
    const another = { ...action, event: { ...(action.operation === "create" ? action.event : {}), title: "Another event" } };
    const unverified = new AutomationService(db, async () => false);
    const second = await unverified.propose(another, actor);
    const secondPreview = await unverified.preview(second.change_id!, actor);
    expect(await unverified.publish(second.change_id!, secondPreview.preview_digest, actor)).toMatchObject({ status: "review", code: "evidence_unverified" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM events").get()).toMatchObject({ n: 0 });
  });
  it("checks the live run grant even after a publisher was authenticated", async () => {
    const { service, actor, action, sqlite } = setup();
    const proposed = await service.propose(action, actor);
    const preview = await service.preview(proposed.change_id!, actor);
    sqlite.prepare("UPDATE official_sync_runs SET auto_publish = 0").run();
    await expect(service.publish(proposed.change_id!, preview.preview_digest, actor)).rejects.toMatchObject({ status: 403 });
  });
  it("requires re-preview if the underlying event changed", async () => {
    const { service, actor, action, sqlite } = setup();
    const proposed = await service.propose(action, actor);
    const preview = await service.preview(proposed.change_id!, actor);
    const first = await service.publish(proposed.change_id!, preview.preview_digest, actor);
    const update = actionSchema.parse({ operation: "update", target_event_id: first.event_id, expected_version: 1, patch: { start_time: "18:00" },
      source_url: action.source_url, reason: "Time announced", evidence_quote: action.evidence_quote, needs_review: false });
    const changed = await service.propose(update, actor);
    const beforeEdit = await service.preview(changed.change_id!, actor);
    sqlite.prepare("UPDATE events SET version = version + 1 WHERE id = ?").run(first.event_id!);
    await expect(service.publish(changed.change_id!, beforeEdit.preview_digest, actor)).rejects.toMatchObject({ code: "preview_changed" });
  });
  it("bounds the number of linked changes per task", async () => {
    const { service, actor, action, sqlite } = setup();
    for (let i = 0; i < 20; i++) {
      await service.propose({ ...action, event: { ...(action.operation === "create" ? action.event : {}), title: `Event ${i}` } }, actor);
    }
    expect((await service.propose({ ...action, event: { ...(action.operation === "create" ? action.event : {}), title: "Event 0" } }, actor)).change_id).toBeTruthy();
    await expect(service.propose(action, actor)).rejects.toMatchObject({ code: "run_limit" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM official_sync_changes").get()).toMatchObject({ n: 20 });
  });
});
