import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OfficialSyncOverview, OfficialSyncRunSummary } from "@frip-fan/core";
import { describe, expect, it } from "vitest";
import { backupHealth, formatAge, formatBytes, parseBackupStatus, readBackupStatus, syncErrorLabel, syncHealth, syncRunTone } from "./ops-status";

const NOW = new Date("2026-11-15T03:00:00.000Z");
const success = {
  created_at: "2026-11-14T20:00:03+00:00", completed_at: "2026-11-14T20:00:09+00:00", app_commit_sha: "a".repeat(40),
  object_key: "sqlite/production/run.sqlite.gz.age", sqlite_bytes: 6_426_624, gzip_bytes: 1_100_000, encrypted_bytes: 1_116_530,
  table_counts: { events: 546, songs: 279 }, migration_count: 19, latest_migration: "0019_admin_chat_history.sql",
};
const file = (patch: Record<string, unknown> = {}) => JSON.stringify({
  format: 1, last_attempt_at: "2026-11-14T20:00:09+00:00", last_attempt_ok: true, last_error: null, failures_since_success: 0,
  last_success: success, ...patch,
});
const found = (patch?: Record<string, unknown>) => ({ state: "found" as const, status: parseBackupStatus(file(patch))! });

describe("backup status", () => {
  it("parses the file the backup script writes", () => {
    expect(parseBackupStatus(file())).toMatchObject({ last_attempt_ok: true, failures_since_success: 0,
      last_success: { created_at: success.created_at, encrypted_bytes: 1_116_530, table_counts: { events: 546, songs: 279 }, migration_count: 19 } });
  });

  it("rejects other shapes instead of showing made-up values", () => {
    for (const source of ["", "[]", "null", "{}", file({ format: 2 }), file({ last_attempt_at: "soon" }), file({ last_attempt_ok: "yes" }), file({ last_success: { created_at: 5 } })]) {
      expect(parseBackupStatus(source)).toBeNull();
    }
    expect(parseBackupStatus(file({ last_success: { ...success, table_counts: { events: "many", songs: 3 }, sqlite_bytes: -1 } }))!.last_success)
      .toMatchObject({ table_counts: { songs: 3 }, sqlite_bytes: null });
  });

  it("reads a file, and tells a missing one from an unreadable one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "backup-status-"));
    try {
      expect(await readBackupStatus(undefined)).toEqual({ state: "missing" });
      expect(await readBackupStatus(join(dir, "none.json"))).toEqual({ state: "missing" });
      expect(await readBackupStatus(dir)).toEqual({ state: "invalid" });
      await writeFile(join(dir, "bad.json"), "{");
      expect(await readBackupStatus(join(dir, "bad.json"))).toEqual({ state: "invalid" });
      await writeFile(join(dir, "ok.json"), file());
      expect(await readBackupStatus(join(dir, "ok.json"))).toMatchObject({ state: "found", status: { last_attempt_ok: true } });
    } finally { await rm(dir, { recursive: true }); }
  });

  it("grades freshness and failures", () => {
    expect(backupHealth({ state: "missing" }, NOW).tone).toBe("neutral");
    expect(backupHealth({ state: "invalid" }, NOW).tone).toBe("warn");
    expect(backupHealth(found(), NOW)).toMatchObject({ tone: "ok", label: "正常" });
    expect(backupHealth(found(), new Date("2026-11-15T21:59:00.000Z")).tone).toBe("ok");
    expect(backupHealth(found(), new Date("2026-11-15T22:01:00.000Z"))).toMatchObject({ tone: "error", label: "已过期" });
    const failed = backupHealth(found({ last_attempt_ok: false, last_error: "ClientError", failures_since_success: 3 }), NOW);
    expect(failed).toMatchObject({ tone: "error", label: "备份失败" });
    expect(failed.detail).toContain("已连续失败 3 次（ClientError）");
    expect(failed.detail).toContain("6 小时前");
    expect(backupHealth(found({ last_attempt_ok: false, last_error: "ValueError", failures_since_success: 1, last_success: null }), NOW))
      .toMatchObject({ tone: "error", label: "从未成功" });
  });
});

describe("formatting", () => {
  it("formats ages and sizes", () => {
    expect(formatAge("2026-11-15T02:59:40.000Z", NOW)).toBe("刚刚");
    expect(formatAge("2026-11-15T02:15:00.000Z", NOW)).toBe("45 分钟前");
    expect(formatAge("2026-11-13T04:00:00.000Z", NOW)).toBe("47 小时前");
    expect(formatAge("2026-11-01T03:00:00.000Z", NOW)).toBe("14 天前");
    expect(formatAge("2026-11-16T03:00:00.000Z", NOW)).toBe("刚刚");
    expect(formatAge(null, NOW)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(6_426_624)).toBe("6.13 MB");
    expect(formatBytes(null)).toBe("—");
  });

  it("labels sync errors, keeping unknown codes visible", () => {
    expect(syncErrorLabel("official_layout_changed")).toBe("官网公告列表的页面结构变了");
    expect(syncErrorLabel("openai_http_429")).toBe("OpenAI 返回 HTTP 429");
    expect(syncErrorLabel("something_new")).toBe("something_new");
    expect(syncErrorLabel(null)).toBeNull();
  });
});

describe("sync health", () => {
  const run = (patch: Partial<OfficialSyncRunSummary> = {}): OfficialSyncRunSummary => ({
    id: "official-2026-11-15", status: "completed", error_code: null, attempts: 0, tool_calls: 0, auto_publish: true, review_attempted: false,
    created_at: "2026-11-15T00:00:00.000Z", updated_at: "2026-11-15T00:10:00.000Z", summary: null, articles: 0, outcomes: {}, unresolved: 0,
    estimated_usd: null, notification_status: null, ...patch,
  });
  const overview = (latest: OfficialSyncRunSummary | null, retrying = 0): OfficialSyncOverview => ({
    latest_run: latest, last_completed_at: null, recent_runs: {}, recent_usd: 0,
    sources: { total: 0, unprocessed: 0, last_fetched_at: null },
    notifications: { waiting: retrying, retrying, last_sent_at: null, last_error_code: null },
  });

  it("grades the latest run", () => {
    expect(syncHealth(overview(null), NOW).tone).toBe("neutral");
    expect(syncHealth(overview(run()), NOW)).toMatchObject({ tone: "ok", label: "正常" });
    expect(syncHealth(overview(run({ status: "running" })), NOW)).toMatchObject({ tone: "ok", label: "运行中" });
    const failed = syncHealth(overview(run({ status: "failed", error_code: "official_source_unavailable" })), NOW);
    expect(failed.tone).toBe("error");
    expect(failed.detail).toContain("官网公告列表无法访问");
    expect(syncHealth(overview(run({ created_at: "2026-11-13T00:00:00.000Z" })), NOW)).toMatchObject({ tone: "warn", label: "没有新任务" });
    expect(syncHealth(overview(run(), 2), NOW)).toMatchObject({ tone: "warn", label: "通知未送达" });
    expect(syncHealth(overview(run({ unresolved: 1 })), NOW)).toMatchObject({ tone: "warn", label: "有事项待处理" });
  });

  it("tones a run row", () => {
    expect(syncRunTone(run())).toBe("ok");
    expect(syncRunTone(run({ unresolved: 2 }))).toBe("warn");
    expect(syncRunTone(run({ status: "failed" }))).toBe("error");
    expect(syncRunTone(run({ status: "running" }))).toBe("neutral");
  });
});
