import type { SessionProgress, Usage } from "./agent";

// Standard, short-context API rates verified 2026-10-30. These estimates are not billing guarantees.
const rates: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
  "gpt-6.1-sol": { input: 2, cached: 0.1, output: 10 },
};
export function estimateUsage(model: string, usage: Usage, searches = 0): number {
  const rate = rates[model]; if (!rate) throw new Error("budget_model_unconfigured");
  const cached = Math.min(usage.input_tokens, usage.input_tokens_details?.cached_tokens ?? 0);
  return ((usage.input_tokens - cached) * rate.input + cached * rate.cached + usage.output_tokens * rate.output) / 1_000_000 + searches * 0.01;
}

export class Budget {
  constructor(private readonly db: D1Database, readonly group: string, private readonly limit = 1) {
    if (!Number.isFinite(limit) || limit <= 0 || limit > 10) throw new Error("budget_configuration_invalid");
  }
  async initialize(): Promise<void> {
    await this.db.prepare("INSERT OR IGNORE INTO official_sync_budgets (id,limit_usd,created_at) VALUES (?,?,?)")
      .bind(this.group, this.limit, new Date().toISOString()).run();
  }
  async exposure(): Promise<number> {
    const row = await this.db.prepare(`SELECT COALESCE(SUM(CASE
      WHEN r.status='active' THEN MAX(r.reserved_usd,COALESCE(u.cost,0))
      WHEN u.n>0 THEN u.cost WHEN r.session_id IS NOT NULL THEN r.reserved_usd ELSE 0 END),0) AS total
      FROM official_sync_reservations r LEFT JOIN
      (SELECT session_id,SUM(estimated_usd) AS cost,COUNT(*) AS n FROM official_sync_usage GROUP BY session_id) u ON u.session_id=r.session_id
      WHERE r.budget_group=?`).bind(this.group).first<{ total: number }>();
    return row?.total ?? 0;
  }
  async reserve(id: string, model: string, amount: number): Promise<boolean> {
    if (!rates[model]) throw new Error("budget_model_unconfigured");
    await this.initialize();
    const existing = await this.db.prepare("SELECT id FROM official_sync_reservations WHERE id=? AND budget_group=?").bind(id, this.group).first();
    if (existing) return true;
    const limit = await this.db.prepare("SELECT limit_usd FROM official_sync_budgets WHERE id=?").bind(this.group).first<{ limit_usd: number }>();
    if (await this.exposure() + amount > (limit?.limit_usd ?? this.limit)) return false;
    await this.db.prepare("INSERT OR IGNORE INTO official_sync_reservations (id,budget_group,model,reserved_usd,status) VALUES (?,?,?,?,'active')")
      .bind(id, this.group, model, amount).run();
    return true;
  }
  async attach(id: string, sessionId: string): Promise<void> {
    await this.db.prepare("UPDATE official_sync_reservations SET session_id=? WHERE id=? AND budget_group=?").bind(sessionId, id, this.group).run();
  }
  async record(sessionId: string, model: string, progress: SessionProgress): Promise<void> {
    if (!progress.usage || !progress.turn_id) return;
    const cost = estimateUsage(model, progress.usage, progress.tools?.web_search_calls ?? 0);
    await this.db.prepare(`INSERT INTO official_sync_usage (session_id,turn_id,budget_group,model,usage_json,estimated_usd,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(session_id,turn_id) DO UPDATE SET usage_json=excluded.usage_json,
      estimated_usd=MAX(official_sync_usage.estimated_usd,excluded.estimated_usd),updated_at=excluded.updated_at`)
      .bind(sessionId, progress.turn_id, this.group, model, JSON.stringify(progress.usage), cost, new Date().toISOString()).run();
  }
  async exceeded(): Promise<boolean> {
    const row = await this.db.prepare("SELECT COALESCE(SUM(estimated_usd),0) AS total FROM official_sync_usage WHERE budget_group=?").bind(this.group).first<{ total: number }>();
    const limit = await this.db.prepare("SELECT limit_usd FROM official_sync_budgets WHERE id=?").bind(this.group).first<{ limit_usd: number }>();
    return (row?.total ?? 0) >= (limit?.limit_usd ?? this.limit);
  }
  async close(id: string): Promise<void> {
    await this.db.prepare("UPDATE official_sync_reservations SET status='closed' WHERE id=? AND budget_group=?").bind(id, this.group).run();
  }
}
