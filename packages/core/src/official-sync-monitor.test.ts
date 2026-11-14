import { describe, expect, it } from "vitest";
import { countBackupTables, countOfficialSyncRuns, getOfficialSyncOverview, listOfficialSyncRuns, listOfficialSyncSources } from "./official-sync-monitor";
import { createTestD1 } from "./test-d1";

const NOW = new Date("2026-11-15T03:00:00.000Z");

function fixture() {
  const { db, sqlite } = createTestD1();
  const run = sqlite.prepare(`INSERT INTO official_sync_runs
    (id, status, session_id, review_session_id, result_json, error_code, attempts, tool_calls, auto_publish, review_attempted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  run.run("official-2026-09-01", "completed", null, null, JSON.stringify({ summary: "很久以前" }), null, 0, 0, 1, 0, "2026-09-01T00:00:00.000Z", "2026-09-01T00:05:00.000Z");
  run.run("official-2026-11-13", "completed", "ses_a", "ses_b", JSON.stringify({ summary: " 2 项已发布 " }), null, 2, 35, 1, 1, "2026-11-13T00:00:00.000Z", "2026-11-13T00:12:00.000Z");
  run.run("official-2026-11-14", "failed", "ses_c", null, "{not json", "official_layout_changed", 5, 0, 0, 0, "2026-11-14T00:00:00.000Z", "2026-11-14T00:25:00.000Z");

  const change = sqlite.prepare(`INSERT INTO change_sets (id, operation, payload_json, status, idempotency_key, created_by, created_via, created_at)
    VALUES (?, 'create', '{}', ?, ?, 'official-sync-agent', 'mcp', 'now')`);
  for (const [id, status] of [["chg_1", "published"], ["chg_2", "published"], ["chg_3", "proposed"]]) {
    change.run(id, status, id);
    sqlite.prepare("INSERT INTO official_sync_changes (run_id, change_id, action_json, created_at) VALUES ('official-2026-11-13', ?, '{}', 'now')").run(id);
  }
  const source = sqlite.prepare(`INSERT INTO official_sync_sources (url, title, published_date, content_hash, paragraphs_json, fetched_at, processed_hash)
    VALUES (?, ?, ?, ?, '[]', ?, ?)`);
  source.run("https://fripside.net/contents/1", "Handled", "2026-11-01", "h1", "2026-11-13T00:01:00.000Z", "h1");
  source.run("https://fripside.net/contents/2", "Edited since", "2026-11-02", "h2b", "2026-11-14T00:01:00.000Z", "h2a");
  source.run("https://fripside.net/contents/3", "Never handled", null, "h3", "2026-11-12T00:01:00.000Z", null);
  sqlite.prepare("INSERT INTO official_sync_run_sources (run_id, url, content_hash) VALUES ('official-2026-11-13', 'https://fripside.net/contents/1', 'h1'), ('official-2026-11-13', 'https://fripside.net/contents/2', 'h2a')").run();
  sqlite.prepare("INSERT INTO official_sync_reviews (run_id, change_id, reason, status) VALUES ('official-2026-11-13', 'chg_3', 'r', 'unresolved'), ('official-2026-11-13', 'chg_1', 'r', 'resolved')").run();
  sqlite.prepare("INSERT INTO official_sync_source_reviews (run_id, source_url, reason, status) VALUES ('official-2026-11-13', 'https://fripside.net/contents/2', 'r', 'budget_stopped')").run();
  sqlite.prepare("INSERT INTO official_sync_budgets (id, limit_usd, created_at) VALUES ('daily', 1, 'now')").run();
  const usage = sqlite.prepare("INSERT INTO official_sync_usage (session_id, turn_id, budget_group, model, usage_json, estimated_usd, updated_at) VALUES (?, ?, 'daily', 'm', '{}', ?, ?)");
  usage.run("ses_a", "t1", 0.1, "2026-11-13T00:05:00.000Z");
  usage.run("ses_b", "t1", 0.25, "2026-11-13T00:10:00.000Z");
  usage.run("ses_old", "t1", 5, "2026-09-01T00:05:00.000Z");
  const notification = sqlite.prepare(`INSERT INTO official_sync_notifications (run_id, status, attempts, last_error_code, sent_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'now', ?)`);
  notification.run("official-2026-09-01", "sent", 1, null, "2026-09-01T00:06:00.000Z", "2026-09-01T00:06:00.000Z");
  notification.run("official-2026-11-13", "pending", 3, "bark_http_500", null, "2026-11-13T00:40:00.000Z");
  notification.run("official-2026-11-14", "skipped", 0, null, null, "2026-11-14T00:26:00.000Z");
  return db;
}

describe("official sync monitor", () => {
  it("lists runs newest first with what they really did", async () => {
    const db = fixture();
    expect(await countOfficialSyncRuns(db)).toBe(3);
    const [failed, published] = await listOfficialSyncRuns(db, 2);
    expect(failed).toMatchObject({ id: "official-2026-11-14", status: "failed", error_code: "official_layout_changed", attempts: 5,
      auto_publish: false, summary: null, articles: 0, outcomes: {}, unresolved: 0, estimated_usd: null, notification_status: "skipped" });
    expect(published).toMatchObject({ id: "official-2026-11-13", summary: "2 项已发布", attempts: 2, tool_calls: 35, auto_publish: true,
      review_attempted: true, articles: 2, outcomes: { published: 2, proposed: 1 }, unresolved: 2, notification_status: "pending" });
    expect(published!.estimated_usd).toBeCloseTo(0.35);
    expect((await listOfficialSyncRuns(db, 2, 2)).map((run) => run.id)).toEqual(["official-2026-09-01"]);
  });

  it("reports change sets by their current status", async () => {
    const db = fixture();
    await db.prepare("UPDATE change_sets SET status = 'published' WHERE id = 'chg_3'").run();
    expect((await listOfficialSyncRuns(db, 2))[1]!.outcomes).toEqual({ published: 3 });
  });

  it("summarises the last 30 days, sources and notification delivery", async () => {
    const overview = await getOfficialSyncOverview(fixture(), NOW);
    expect(overview.latest_run?.id).toBe("official-2026-11-14");
    expect(overview.last_completed_at).toBe("2026-11-13T00:12:00.000Z");
    expect(overview.recent_runs).toEqual({ completed: 1, failed: 1 });
    expect(overview.recent_usd).toBeCloseTo(0.35);
    expect(overview.sources).toEqual({ total: 3, unprocessed: 2, last_fetched_at: "2026-11-14T00:01:00.000Z" });
    expect(overview.notifications).toEqual({ waiting: 1, retrying: 1, last_sent_at: "2026-09-01T00:06:00.000Z", last_error_code: "bark_http_500" });
  });

  it("lists recently fetched notices and whether they were handled", async () => {
    const sources = await listOfficialSyncSources(fixture(), 2);
    expect(sources.map((source) => [source.title, source.processed])).toEqual([["Edited since", false], ["Handled", true]]);
  });

  it("is empty rather than failing before the first run", async () => {
    const { db } = createTestD1();
    expect(await listOfficialSyncRuns(db)).toEqual([]);
    expect(await getOfficialSyncOverview(db, NOW)).toEqual({
      latest_run: null, last_completed_at: null, recent_runs: {}, recent_usd: 0,
      sources: { total: 0, unprocessed: 0, last_fetched_at: null },
      notifications: { waiting: 0, retrying: 0, last_sent_at: null, last_error_code: null },
    });
    expect(await countBackupTables(db)).toEqual({ events: 0, songs: 0, releases: 0, setlists: 0, change_sets: 0, audit_logs: 0 });
  });
});
