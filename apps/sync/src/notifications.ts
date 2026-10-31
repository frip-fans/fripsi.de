import { boundedText } from "@frip-fan/core";

export interface BarkEnv {
  DB: D1Database;
  BARK_ENABLED?: string;
  BARK_DEVICE_KEY?: string;
  BARK_SITE_URL?: string;
}
interface NotificationPayload { title: string; body: string; url: string; group: string }
interface TerminalRun { id: string; status: string; error_code: string | null }
interface PublishedChange { event_id: string; operation: string; title: string; slug: string; start_date: string; start_time: string | null; status: string }
interface Delivery { run_id: string; payload_json: string; attempts: number }
class DeliveryError extends Error { constructor(readonly code: string) { super(code); } }

function truncate(text: string, bytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= bytes) return text;
  let result = "", length = 0;
  for (const character of text) {
    const size = encoder.encode(character).length;
    if (length + size > bytes - 3) break;
    result += character; length += size;
  }
  return result + "…";
}

async function payloadForRun(db: D1Database, run: TerminalRun, site: string): Promise<NotificationPayload | null> {
  // Publication rows are authoritative; never trust a model's claimed count.
  const published = await db.prepare(`SELECT e.id AS event_id,c.operation,e.title,e.slug,e.start_date,e.start_time,e.status
    FROM official_sync_changes s JOIN change_sets c ON c.id=s.change_id
    JOIN events e ON e.id=COALESCE(c.target_event_id,json_extract(c.payload_json,'$.event.id'))
    WHERE s.run_id=? AND c.status='published' AND e.published=1 AND e.archived_at IS NULL
    ORDER BY c.published_at,c.id`).bind(run.id).all<PublishedChange>();
  const pending = await db.prepare(`SELECT
    EXISTS(SELECT 1 FROM official_sync_reviews WHERE run_id=? AND status IN ('unresolved','budget_stopped'))
    OR EXISTS(SELECT 1 FROM official_sync_source_reviews WHERE run_id=? AND status IN ('unresolved','budget_stopped')) AS needed`)
    .bind(run.id, run.id).first<{ needed: number }>();
  const unique = new Map<string, PublishedChange>();
  for (const change of published.results) unique.set(change.event_id, {
    ...change, operation: unique.get(change.event_id)?.operation === "create" ? "create" : change.operation,
  });
  const changes = [...unique.values()], failed = run.status === "failed", needsAttention = Boolean(pending?.needed);
  if (!changes.length && !failed && !needsAttention) return null;
  const created = changes.filter((change) => change.operation === "create").length;
  const lines: string[] = [];
  if (changes.length) lines.push(`已发布：新增 ${created} 条，更新 ${changes.length - created} 条。`);
  for (const change of changes.slice(0, 4)) {
    const label = change.operation === "create" ? "新增" : change.status === "cancelled" ? "取消" : "更新";
    lines.push(`${label} ${change.start_date}${change.start_time ? ` ${change.start_time}` : ""} ${truncate(change.title, 160)}\n${site}/events/${encodeURIComponent(change.slug)}`);
  }
  if (changes.length > 4) lines.push(`另有 ${changes.length - 4} 条，请查看站点。`);
  if (failed) lines.push(`同步任务未完成${run.error_code && /^[a-z0-9_]{1,80}$/.test(run.error_code) ? `（${run.error_code}）` : ""}。`);
  if (needsAttention) lines.push("自动复核后仍有事项待核实，可查看后台变更记录。");
  const prefix = new URL(site).hostname === "fripsi.de" ? "fripSi.de" : "fripSi.de [测试]";
  return {
    title: `${prefix} ${failed ? "同步异常" : needsAttention ? "更新与待核实事项" : "活动更新"}`,
    body: truncate(lines.join("\n\n"), 2000),
    url: changes.length === 1 ? `${site}/events/${encodeURIComponent(changes[0].slug)}` : changes.length ? `${site}/` : `${site}/admin/changes`,
    group: "fripsi-official-sync",
  };
}

async function enqueue(db: D1Database, site: string, now: Date): Promise<void> {
  const timestamp = now.toISOString();
  await db.prepare("INSERT OR IGNORE INTO official_sync_notification_state(channel,activated_at) VALUES ('bark',?)").bind(timestamp).run();
  const state = await db.prepare("SELECT activated_at FROM official_sync_notification_state WHERE channel='bark'").first<{ activated_at: string }>();
  if (!state) return;
  const runs = await db.prepare(`SELECT r.id,r.status,r.error_code FROM official_sync_runs r
    WHERE r.auto_publish=1 AND r.status IN ('completed','failed') AND r.updated_at>=?
    AND NOT EXISTS (SELECT 1 FROM official_sync_notifications n WHERE n.run_id=r.id)
    ORDER BY r.updated_at,r.id LIMIT 10`).bind(state.activated_at).all<TerminalRun>();
  for (const run of runs.results) {
    const payload = await payloadForRun(db, run, site);
    await db.prepare(`INSERT OR IGNORE INTO official_sync_notifications
      (run_id,payload_json,status,available_at,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .bind(run.id, payload ? JSON.stringify(payload) : null, payload ? "pending" : "skipped", now.valueOf(), timestamp, timestamp).run();
  }
}

async function send(payload: NotificationPayload, key: string, request: typeof fetch): Promise<void> {
  const response = await request("https://api.day.app/push", {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", "User-Agent": "fripsi-bark-notifications/1.0" },
    body: JSON.stringify({ ...payload, device_key: key }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new DeliveryError(`bark_http_${response.status}`); }
  const result = JSON.parse(await boundedText(response, 8192)) as { code?: number };
  if (result.code !== 200) throw new DeliveryError("bark_rejected");
}

export async function tickNotifications(env: BarkEnv, now = new Date(), request: typeof fetch = fetch.bind(globalThis)): Promise<void> {
  if (env.BARK_ENABLED !== "true" || !env.BARK_DEVICE_KEY?.trim()) return;
  const key = env.BARK_DEVICE_KEY.trim(), site = new URL(env.BARK_SITE_URL || "https://fripsi.de");
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(key) || site.protocol !== "https:" || site.username || site.password || site.pathname !== "/" || site.search || site.hash) {
    throw new DeliveryError("bark_configuration_invalid");
  }
  await enqueue(env.DB, site.origin, now);
  const ready = await env.DB.prepare(`SELECT run_id,payload_json,attempts FROM official_sync_notifications
    WHERE available_at<=? AND (status='pending' OR (status='sending' AND locked_until<=?))
    ORDER BY available_at,created_at,run_id LIMIT 3`).bind(now.valueOf(), now.valueOf()).all<Delivery>();
  for (const row of ready.results) {
    const claim = crypto.randomUUID();
    const acquired = await env.DB.prepare(`UPDATE official_sync_notifications SET status='sending',claim_id=?,locked_until=?,attempts=attempts+1,updated_at=?
      WHERE run_id=? AND available_at<=? AND (status='pending' OR (status='sending' AND locked_until<=?))`)
      .bind(claim, now.valueOf() + 60_000, now.toISOString(), row.run_id, now.valueOf(), now.valueOf()).run();
    if (!acquired.meta.changes) continue;
    try {
      const payload = JSON.parse(row.payload_json) as NotificationPayload;
      if (typeof payload.body !== "string" || typeof payload.title !== "string" || new URL(payload.url).origin !== site.origin
        || new TextEncoder().encode(JSON.stringify({ ...payload, device_key: key })).length > 3500) throw new DeliveryError("bark_payload_invalid");
      await send(payload, key, request);
      await env.DB.prepare(`UPDATE official_sync_notifications SET status='sent',sent_at=?,updated_at=?,locked_until=0,claim_id=NULL,last_error_code=NULL
        WHERE run_id=? AND claim_id=?`).bind(now.toISOString(), now.toISOString(), row.run_id, claim).run();
      console.log(JSON.stringify({ action: "official_sync.notification_sent", run_id: row.run_id }));
    } catch (error) {
      const code = error instanceof DeliveryError ? error.code : "bark_delivery_failed";
      const delay = Math.min(6 * 3_600_000, 300_000 * 2 ** Math.min(row.attempts, 7));
      await env.DB.prepare(`UPDATE official_sync_notifications SET status='pending',available_at=?,updated_at=?,locked_until=0,claim_id=NULL,last_error_code=?
        WHERE run_id=? AND claim_id=?`).bind(now.valueOf() + delay, now.toISOString(), code, row.run_id, claim).run();
      console.error(JSON.stringify({ action: "official_sync.notification_retry", run_id: row.run_id, code }));
    }
  }
}

// Notification errors cannot prevent publication, completion recording, or later retries.
export async function safeTickNotifications(env: BarkEnv): Promise<void> {
  try { await tickNotifications(env); }
  catch (error) { console.error(JSON.stringify({ action: "official_sync.notification_error", code: error instanceof DeliveryError ? error.code : "notification_tick_failed" })); }
}
