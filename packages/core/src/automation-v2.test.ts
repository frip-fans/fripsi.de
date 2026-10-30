/// <reference types="node" />
import { afterEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createTestD1 } from "./test-d1";
import { AutomationService } from "./automation-service";
import { parseOfficialArticle } from "./official-source";
import { actionSchema } from "./official-sync-schema";
import type { Actor } from "./types";
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function setup(body = '<h4>開催日程</h4><p>2026年11月24日 20:30 開始予定</p><h4>募集期間</h4><p>2026年10月25日 23:59まで</p>') {
  const { db, sqlite } = createTestD1(); databases.push(sqlite);
  const now = new Date().toISOString(), url = "https://fripside.net/contents/1123461";
  const source = await parseOfficialArticle(url, `<article class="corner-content"><h2>製作委員会の森 第31回</h2><time datetime="2026-10-29"></time><div class="corner-content-body">${body}</div></article>`);
  sqlite.prepare("INSERT INTO official_sync_runs (id,status,auto_publish,policy_version,created_at,updated_at) VALUES ('run','running',1,'official-sync-v2',?,?)").run(now, now);
  sqlite.prepare("INSERT INTO official_sync_sources (url,title,published_date,content_hash,paragraphs_json,fetched_at) VALUES (?,?,?,?,?,?)").run(url, source.title, source.published_date, source.content_hash, JSON.stringify(source.paragraphs), now);
  const actor: Actor = { id: "official-sync-agent", type: "ai", channel: "mcp", automation_role: "primary", automation_run_id: "run", scopes: ["events:read", "events:draft", "events:publish", "events:auto_publish"] };
  const service = new AutomationService(db, async () => { throw new Error("legacy quote verification should not run"); }, async () => source);
  const refs = [source.paragraphs.find((part) => part.text.includes("2026年11月24日"))!.id];
  const action = actionSchema.parse({ operation: "create", source_url: url, source_revision: source.content_hash, evidence_refs: refs, reason: "official date", needs_review: false,
    event: { title: "【番組】製作委員会の森 第31回", start_date: "2026-11-24", start_time: "20:30", category: "MEDIA", classification: "Web生放送", location_mode: "online", channels: [{ channel_type: "streaming", name: "freakSide" }], sources: [{ url }] } });
  return { db, sqlite, actor, service, source, action };
}

it("publishes using server-verified paragraph IDs without making the model copy a quote", async () => {
  const { service, actor, action, sqlite } = await setup();
  const proposed = await service.propose(action, actor);
  expect(proposed.status).toBe("proposed"); expect(proposed.change_set_id).toBe(proposed.change_id);
  const preview = await service.preview(proposed.change_set_id!, actor);
  expect((await service.publish(proposed.change_set_id!, preview.preview_digest, actor)).status).toBe("published");
  expect(sqlite.prepare("SELECT classification FROM events").get()).toMatchObject({ classification: "生放送" });
});

it("repairs evidence on the same proposal and invalidates the previous preview", async () => {
  const { service, actor, action, source, sqlite } = await setup();
  const first = await service.propose({ ...action, evidence_refs: [source.paragraphs[0].id, ...action.evidence_refs] }, actor);
  const preview = await service.preview(first.change_set_id!, actor);
  const repaired = await service.propose(action, actor);
  expect(repaired.change_set_id).toBe(first.change_set_id);
  await expect(service.publish(repaired.change_set_id!, preview.preview_digest, actor)).rejects.toMatchObject({ code: "preview_required" });
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM change_sets").get()).toMatchObject({ n: 1 });
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='automation.evidence_corrected'").get()).toMatchObject({ n: 1 });
});

it("rejects registration dates as event dates with a repairable error", async () => {
  const { service, actor, action, source, sqlite } = await setup();
  const deadline = source.paragraphs.find((part) => part.text.includes("2026年10月25日"))!;
  await expect(service.propose({ ...action, evidence_refs: [deadline.id], event: { ...(action.operation === "create" ? action.event : {}), start_date: "2026-10-25", start_time: null } }, actor)).rejects.toMatchObject({ code: "date_evidence_missing" });
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM change_sets").get()).toMatchObject({ n: 0 });
});

it("accepts the announcement date for an already published report, without replacing an explicit occurrence date", async () => {
  const { service, actor, action, source } = await setup('<p>Skream!にてライブレポートが公開されました。</p><p>2026年11月24日</p>');
  if (action.operation !== "create") throw new Error("fixture");
  const report = { ...action, evidence_refs: [source.paragraphs[0].id], event: { ...action.event, title: "Skream!ライブレポート", classification: "WEB", start_date: "2026-10-29", start_time: null } };
  expect((await service.propose(report, actor)).status).toBe("proposed");
  await expect(service.propose({ ...report, evidence_refs: source.paragraphs.map((part) => part.id) }, actor)).rejects.toMatchObject({ code: "date_evidence_missing" });
});

it("rejects copied quotes without paragraph references in a v2 task", async () => {
  const { service, actor, action } = await setup();
  await expect(service.propose({ ...action, evidence_refs: [], evidence_quote: "2026年11月24日20:30開始予定です。" }, actor)).rejects.toMatchObject({ code: "source_evidence_required" });
});

it("does not require human review merely because the time and venue are unpublished", async () => {
  const { service, actor, action } = await setup();
  const proposed = await service.propose({ ...action, event: { ...(action.operation === "create" ? action.event : {}), start_time: null, category: "EVENT", location_mode: "undisclosed", channels: [] } }, actor);
  const preview = await service.preview(proposed.change_set_id!, actor);
  expect((await service.publish(proposed.change_set_id!, preview.preview_digest, actor)).status).toBe("published");
});

it("routes unresolved items through one automatic review, with no recursive upgrades", async () => {
  const { service, actor, action } = await setup();
  const proposed = await service.propose({ ...action, needs_review: true }, actor);
  expect(await service.requestReview(proposed.change_set_id!, "date needs corroboration", actor)).toMatchObject({ status: "review_queued" });
  expect(await service.requestReview(proposed.change_set_id!, "no definitive official information", { ...actor, automation_role: "review" })).toMatchObject({ status: "pending_information" });
});

it("bounds read and write tool use, not only publication count", async () => {
  const { service, actor, sqlite } = await setup();
  for (let i = 0; i < 80; i++) await service.countTool(actor);
  await expect(service.countTool(actor)).rejects.toMatchObject({ code: "tool_budget_exceeded" });
  expect(sqlite.prepare("SELECT stop_requested FROM official_sync_runs").get()).toMatchObject({ stop_requested: 1 });
});
