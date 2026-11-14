/** Read-only views of the official sync tables for the admin status page. */

export interface OfficialSyncRunSummary {
  id: string;
  status: string;
  error_code: string | null;
  /** Failed steps so far; a completed run above zero recovered by retrying. */
  attempts: number;
  tool_calls: number;
  auto_publish: boolean;
  review_attempted: boolean;
  created_at: string;
  updated_at: string;
  /** The agent's own one-line report; what was really published is in `outcomes`. */
  summary: string | null;
  /** Notices handed to the model for this run. */
  articles: number;
  /** Linked change sets by their current status, e.g. `{ published: 2, proposed: 1 }`. */
  outcomes: Record<string, number>;
  /** Reviews that ended unresolved or were stopped by the budget. */
  unresolved: number;
  estimated_usd: number | null;
  notification_status: string | null;
}

export interface OfficialSyncSourceSummary {
  url: string;
  title: string;
  published_date: string | null;
  fetched_at: string;
  /** False while the latest fetched text has not been handled by a finished run. */
  processed: boolean;
}

export interface OfficialSyncOverview {
  latest_run: OfficialSyncRunSummary | null;
  last_completed_at: string | null;
  /** Runs created in the 30 days before `now`, by status. */
  recent_runs: Record<string, number>;
  recent_usd: number;
  sources: { total: number; unprocessed: number; last_fetched_at: string | null };
  notifications: { waiting: number; retrying: number; last_sent_at: string | null; last_error_code: string | null };
}

interface RunRow {
  id: string; status: string; error_code: string | null; attempts: number; tool_calls: number;
  auto_publish: number; review_attempted: number; created_at: string; updated_at: string;
  result_json: string | null; articles: number; unresolved: number;
  estimated_usd: number | null; notification_status: string | null;
}

const RUN_COLUMNS = `r.id, r.status, r.error_code, r.attempts, r.tool_calls, r.auto_publish, r.review_attempted,
  r.created_at, r.updated_at, r.result_json,
  (SELECT COUNT(*) FROM official_sync_run_sources rs WHERE rs.run_id = r.id) AS articles,
  (SELECT COUNT(*) FROM official_sync_reviews v WHERE v.run_id = r.id AND v.status IN ('unresolved', 'budget_stopped'))
    + (SELECT COUNT(*) FROM official_sync_source_reviews sv WHERE sv.run_id = r.id AND sv.status IN ('unresolved', 'budget_stopped')) AS unresolved,
  (SELECT SUM(u.estimated_usd) FROM official_sync_usage u WHERE u.session_id IN (r.session_id, r.review_session_id)) AS estimated_usd,
  (SELECT n.status FROM official_sync_notifications n WHERE n.run_id = r.id) AS notification_status`;

function reportSummary(json: string | null): string | null {
  if (!json) return null;
  try {
    const summary = (JSON.parse(json) as { summary?: unknown }).summary;
    return typeof summary === "string" && summary.trim() ? summary.trim() : null;
  } catch { return null; }
}

async function summarize(db: D1Database, rows: RunRow[]): Promise<OfficialSyncRunSummary[]> {
  const outcomes = new Map<string, Record<string, number>>();
  if (rows.length) {
    // Current change set states, not the snapshot saved when the run ended:
    // a proposal published by hand afterwards should read as published.
    const linked = await db.prepare(`SELECT s.run_id, c.status, COUNT(*) AS total
      FROM official_sync_changes s JOIN change_sets c ON c.id = s.change_id
      WHERE s.run_id IN (${rows.map(() => "?").join(",")}) GROUP BY s.run_id, c.status`)
      .bind(...rows.map((row) => row.id)).all<{ run_id: string; status: string; total: number }>();
    for (const row of linked.results) outcomes.set(row.run_id, { ...outcomes.get(row.run_id), [row.status]: row.total });
  }
  return rows.map((row) => ({
    id: row.id, status: row.status, error_code: row.error_code, attempts: row.attempts, tool_calls: row.tool_calls,
    auto_publish: row.auto_publish === 1, review_attempted: row.review_attempted === 1,
    created_at: row.created_at, updated_at: row.updated_at, summary: reportSummary(row.result_json),
    articles: row.articles, outcomes: outcomes.get(row.id) ?? {}, unresolved: row.unresolved,
    estimated_usd: row.estimated_usd, notification_status: row.notification_status,
  }));
}

export async function listOfficialSyncRuns(db: D1Database, limit = 20, offset = 0): Promise<OfficialSyncRunSummary[]> {
  const rows = await db.prepare(`SELECT ${RUN_COLUMNS} FROM official_sync_runs r ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`)
    .bind(limit, offset).all<RunRow>();
  return summarize(db, rows.results);
}

export async function countOfficialSyncRuns(db: D1Database): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS total FROM official_sync_runs").first<{ total: number }>())?.total ?? 0;
}

export async function listOfficialSyncSources(db: D1Database, limit = 8): Promise<OfficialSyncSourceSummary[]> {
  const rows = await db.prepare(`SELECT url, title, published_date, fetched_at, processed_hash IS content_hash AS processed
    FROM official_sync_sources ORDER BY fetched_at DESC, url DESC LIMIT ?`).bind(limit)
    .all<Omit<OfficialSyncSourceSummary, "processed"> & { processed: number }>();
  return rows.results.map((row) => ({ ...row, processed: row.processed === 1 }));
}

export async function getOfficialSyncOverview(db: D1Database, now = new Date()): Promise<OfficialSyncOverview> {
  const since = new Date(now.valueOf() - 30 * 86_400_000).toISOString();
  const [latest] = await listOfficialSyncRuns(db, 1);
  const completed = await db.prepare("SELECT MAX(updated_at) AS at FROM official_sync_runs WHERE status = 'completed'").first<{ at: string | null }>();
  const recent = await db.prepare("SELECT status, COUNT(*) AS total FROM official_sync_runs WHERE created_at >= ? GROUP BY status")
    .bind(since).all<{ status: string; total: number }>();
  const spend = await db.prepare("SELECT SUM(estimated_usd) AS usd FROM official_sync_usage WHERE updated_at >= ?").bind(since).first<{ usd: number | null }>();
  const sources = await db.prepare(`SELECT COUNT(*) AS total, SUM(processed_hash IS NOT content_hash) AS unprocessed, MAX(fetched_at) AS last_fetched_at
    FROM official_sync_sources`).first<{ total: number; unprocessed: number | null; last_fetched_at: string | null }>();
  const notifications = await db.prepare(`SELECT
      SUM(status IN ('pending', 'sending')) AS waiting,
      SUM(status IN ('pending', 'sending') AND attempts > 0) AS retrying,
      MAX(sent_at) AS last_sent_at,
      (SELECT last_error_code FROM official_sync_notifications
        WHERE status IN ('pending', 'sending') AND attempts > 0 ORDER BY updated_at DESC LIMIT 1) AS last_error_code
    FROM official_sync_notifications`).first<{ waiting: number | null; retrying: number | null; last_sent_at: string | null; last_error_code: string | null }>();
  return {
    latest_run: latest ?? null,
    last_completed_at: completed?.at ?? null,
    recent_runs: Object.fromEntries(recent.results.map((row) => [row.status, row.total])),
    recent_usd: spend?.usd ?? 0,
    sources: { total: sources?.total ?? 0, unprocessed: sources?.unprocessed ?? 0, last_fetched_at: sources?.last_fetched_at ?? null },
    notifications: {
      waiting: notifications?.waiting ?? 0, retrying: notifications?.retrying ?? 0,
      last_sent_at: notifications?.last_sent_at ?? null, last_error_code: notifications?.last_error_code ?? null,
    },
  };
}

/** The tables a backup manifest counts, so the page can compare live rows with the last snapshot. */
export const BACKUP_COUNTED_TABLES = ["events", "songs", "releases", "setlists", "change_sets", "audit_logs"] as const;

export async function countBackupTables(db: D1Database): Promise<Record<(typeof BACKUP_COUNTED_TABLES)[number], number>> {
  const row = await db.prepare(`SELECT ${BACKUP_COUNTED_TABLES.map((table) => `(SELECT COUNT(*) FROM ${table}) AS ${table}`).join(", ")}`)
    .first<Record<(typeof BACKUP_COUNTED_TABLES)[number], number>>();
  return row!;
}
