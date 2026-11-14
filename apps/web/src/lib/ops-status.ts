import { readFile } from "node:fs/promises";
import type { OfficialSyncOverview } from "@frip-fan/core";

export type Tone = "ok" | "warn" | "error" | "neutral";
export interface Health { tone: Tone; label: string; detail: string }

export interface BackupSuccess {
  created_at: string;
  completed_at: string | null;
  app_commit_sha: string | null;
  object_key: string | null;
  sqlite_bytes: number | null;
  encrypted_bytes: number | null;
  table_counts: Record<string, number>;
  migration_count: number | null;
  latest_migration: string | null;
}
export interface BackupStatus {
  last_attempt_at: string;
  last_attempt_ok: boolean;
  /** Python exception class name only; the script never records messages. */
  last_error: string | null;
  failures_since_success: number;
  last_success: BackupSuccess | null;
}
export type BackupStatusResult = { state: "missing" } | { state: "invalid" } | { state: "found"; status: BackupStatus };

/** The backup runs daily; allow for a slow run before calling the last one overdue. */
export const BACKUP_STALE_MS = 26 * 3_600_000;
/** The sync starts one task per Japan day. */
export const SYNC_STALE_MS = 36 * 3_600_000;

const text = (value: unknown) => typeof value === "string" && value ? value : null;
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

/** Reads the summary written by `ops/sqlite-backup/sqlite_backup.py`; anything unexpected is treated as unreadable. */
export function parseBackupStatus(source: string): BackupStatus | null {
  let raw: unknown;
  try { raw = JSON.parse(source); } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const attempt = timestamp(data.last_attempt_at);
  if (data.format !== 1 || !attempt || typeof data.last_attempt_ok !== "boolean") return null;
  let success: BackupSuccess | null = null;
  if (data.last_success && typeof data.last_success === "object") {
    const item = data.last_success as Record<string, unknown>;
    const created = timestamp(item.created_at);
    if (!created) return null;
    const counts = item.table_counts && typeof item.table_counts === "object" ? item.table_counts as Record<string, unknown> : {};
    success = {
      created_at: created, completed_at: timestamp(item.completed_at), app_commit_sha: text(item.app_commit_sha),
      object_key: text(item.object_key), sqlite_bytes: count(item.sqlite_bytes), encrypted_bytes: count(item.encrypted_bytes),
      table_counts: Object.fromEntries(Object.entries(counts).filter((entry): entry is [string, number] => count(entry[1]) !== null)),
      migration_count: count(item.migration_count), latest_migration: text(item.latest_migration),
    };
  }
  return {
    last_attempt_at: attempt, last_attempt_ok: data.last_attempt_ok, last_error: text(data.last_error),
    failures_since_success: count(data.failures_since_success) ?? 0, last_success: success,
  };
}

export async function readBackupStatus(path: string | undefined): Promise<BackupStatusResult> {
  if (!path) return { state: "missing" };
  let source: string;
  try { source = await readFile(path, "utf8"); } catch (error) {
    return { state: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "invalid" };
  }
  const status = parseBackupStatus(source);
  return status ? { state: "found", status } : { state: "invalid" };
}

/** "3 小时前"; future or unparsable times fall back to "刚刚" / "—". */
export function formatAge(value: string | null | undefined, now: Date): string {
  const at = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(at)) return "—";
  const minutes = Math.floor((now.valueOf() - at) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

export function backupHealth(result: BackupStatusResult, now: Date): Health {
  if (result.state === "missing") return { tone: "neutral", label: "无记录", detail: "没有找到备份状态文件。本环境没有启用定时备份，或主机上的备份脚本还不会写状态文件。" };
  if (result.state === "invalid") return { tone: "warn", label: "无法读取", detail: "备份状态文件存在，但读不出来或格式不对。请到主机查看 fripside-backup.service 的日志。" };
  const { status } = result;
  const success = status.last_success;
  const failures = status.failures_since_success > 1 ? `已连续失败 ${status.failures_since_success} 次` : "最近一次备份失败";
  const error = status.last_error ? `（${status.last_error}）` : "";
  if (!success) return { tone: "error", label: "从未成功", detail: `${failures}${error}，还没有任何成功的备份。` };
  const overdue = now.valueOf() - Date.parse(success.created_at) > BACKUP_STALE_MS;
  if (!status.last_attempt_ok) {
    return { tone: "error", label: "备份失败", detail: `${failures}${error}。可用的最新备份是 ${formatAge(success.created_at, now)}的。` };
  }
  if (overdue) return { tone: "error", label: "已过期", detail: `最近一次成功的备份是 ${formatAge(success.created_at, now)}的，超过一天没有新备份，定时器可能没有运行。` };
  return { tone: "ok", label: "正常", detail: `最近一次备份在 ${formatAge(success.created_at, now)}完成并通过了远端核对。` };
}

const SYNC_ERROR_LABELS: Record<string, string> = {
  official_source_unavailable: "官网公告列表无法访问",
  official_layout_changed: "官网公告列表的页面结构变了",
  official_articles_unreadable: "公告正文全部读取失败",
  agent_turn_failed: "模型任务失败",
  review_turn_failed: "复核任务失败",
  agent_output_missing: "模型没有返回报告",
  soft_budget_exhausted: "预算用尽",
  budget_model_unconfigured: "模型没有配置价格",
  openai_key_format_invalid: "OpenAI key 格式不对",
  sync_configuration_missing: "同步配置不完整",
  sync_step_failed: "同步步骤出错",
  run_expired: "超过一小时没有完成",
  tool_budget_exceeded: "工具调用次数超限",
  operator_cancelled_before_start: "启动前被人工取消",
};

export function syncErrorLabel(code: string | null): string | null {
  if (!code) return null;
  const http = /^openai_http_(\d{3})$/.exec(code);
  return http ? `OpenAI 返回 HTTP ${http[1]}` : SYNC_ERROR_LABELS[code] ?? code;
}

export const SYNC_RUN_STATUS_LABELS: Record<string, string> = {
  starting: "准备中", running: "运行中", applying: "写入中", completed: "完成", failed: "失败",
};
export const SYNC_NOTIFICATION_LABELS: Record<string, string> = {
  pending: "待发送", sending: "发送中", sent: "已通知", skipped: "无需通知",
};

export function syncRunTone(run: { status: string; unresolved: number }): Tone {
  if (run.status === "failed") return "error";
  if (run.status !== "completed") return "neutral";
  return run.unresolved ? "warn" : "ok";
}

export function syncHealth(overview: OfficialSyncOverview, now: Date): Health {
  const run = overview.latest_run;
  if (!run) return { tone: "neutral", label: "无记录", detail: "这个环境还没有运行过同步任务。" };
  if (run.status === "failed") {
    return { tone: "error", label: "最近一次失败", detail: `${formatAge(run.created_at, now)}的任务没有完成：${syncErrorLabel(run.error_code) ?? "原因未记录"}。` };
  }
  if (run.status !== "completed") return { tone: "ok", label: "运行中", detail: `${formatAge(run.created_at, now)}开始的任务还在进行。` };
  if (now.valueOf() - Date.parse(run.created_at) > SYNC_STALE_MS) {
    return { tone: "warn", label: "没有新任务", detail: `最近一次任务是 ${formatAge(run.created_at, now)}的。同步每天最多启动一次；如果本环境没有停用同步，说明定时器没有在运行。` };
  }
  if (overview.notifications.retrying) {
    return { tone: "warn", label: "通知未送达", detail: `同步正常，但有 ${overview.notifications.retrying} 条 Bark 通知发送失败，正在重试。` };
  }
  if (run.unresolved) return { tone: "warn", label: "有事项待处理", detail: `最近一次任务完成，但有 ${run.unresolved} 项复核后仍未解决。` };
  return { tone: "ok", label: "正常", detail: `最近一次任务在 ${formatAge(run.updated_at, now)}完成。` };
}
