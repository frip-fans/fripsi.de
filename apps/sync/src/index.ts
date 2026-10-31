import { signAutomationToken, SYNC_POLICY_VERSION } from "@frip-fan/core";
import { AgentsClient, agentReportSchema, type AgentReport, type SessionProgress } from "./agent";
import { Budget } from "./budget";
import { discover, DISCOVERY_LOOKBACK_DAYS } from "./discovery";
import { tickEvaluations } from "./evaluations";
import { instructions, reviewInstructions } from "./prompt";
import { safeTickNotifications, type BarkEnv } from "./notifications";

export interface SyncEnv extends BarkEnv {
  DB: D1Database;
  OPENAI_API_KEY?: string; OPENAI_MODEL?: string; OPENAI_REVIEW_MODEL?: string;
  SYNC_ENABLED?: string; SYNC_AUTO_PUBLISH?: string; SYNC_DISCOVERY_ENABLED?: string;
  SYNC_EVAL_ENABLED?: string; SYNC_BUDGET_GROUP?: string; SYNC_BUDGET_USD?: string;
  MCP_ENDPOINT_URL?: string; AUTOMATION_SIGNING_SECRET?: string;
  MCP_ACCESS_CLIENT_ID?: string; MCP_ACCESS_CLIENT_SECRET?: string;
}
interface Run {
  id: string; status: string; session_id: string | null; input_json: string | null;
  result_json: string | null; created_at: string; attempts: number; auto_publish: number;
  budget_group: string | null; primary_done: number; stop_requested: number;
  review_attempted: number; review_session_id: string | null; review_input_json: string | null; review_report_json: string | null;
}
interface Manifest {
  model: string; mcp_url: string; auto_publish: boolean; prompt: string; input: {
    today: string; lookback_days: number; run_id: string; auto_publish: boolean;
    articles?: Array<{ source_url: string; title: string }>;
    source_errors?: unknown[]; review_change_ids?: string[]; review_source_urls?: string[];
  };
}
export interface TrialOptions { runId: string; draftOnly: true; forceSources?: boolean }

async function cancel(client: AgentsClient, session: string | null): Promise<void> {
  if (!session) return;
  try { await client.call(`sessions/${encodeURIComponent(session)}/events`, { events: [{ type: "agent.session.input.cancel" }] }); } catch { /* Session may already be terminal. */ }
}
function report(progress: SessionProgress): AgentReport {
  return { ...agentReportSchema.parse(progress.output), ...(progress.usage ? { observed_usage: progress.usage } : {}), ...(progress.tools ? { observed_tools: progress.tools } : {}) };
}
async function startSession(client: AgentsClient, env: SyncEnv, run: Run, manifest: Manifest, role: "primary" | "review") {
  const token = await signAutomationToken(env.AUTOMATION_SIGNING_SECRET!, manifest.mcp_url, run.id, run.created_at, role);
  return client.start(manifest.model, manifest.input, `${run.id}:${role}:v2`, {
    url: manifest.mcp_url, authorization: `Bearer ${token}`, autoPublish: manifest.auto_publish,
    ...(env.MCP_ACCESS_CLIENT_ID && env.MCP_ACCESS_CLIENT_SECRET ? { headers: {
      "CF-Access-Client-Id": env.MCP_ACCESS_CLIENT_ID, "CF-Access-Client-Secret": env.MCP_ACCESS_CLIENT_SECRET,
    } } : {}),
  }, manifest.prompt);
}

async function queueReviews(db: D1Database, run: Run, primary: AgentReport, manifest: Manifest) {
  if (run.auto_publish === 1) await db.prepare(`INSERT OR IGNORE INTO official_sync_reviews (run_id,change_id,reason,status)
    SELECT s.run_id,s.change_id,'常规任务结束后仍未发布，自动复核','queued' FROM official_sync_changes s
    JOIN change_sets c ON c.id=s.change_id WHERE s.run_id=? AND c.status='proposed'`).bind(run.id).run();
  const outcomes = new Set(primary.source_outcomes.map((source) => source.source_url));
  for (const article of manifest.input.articles ?? []) {
    if (outcomes.has(article.source_url)) continue;
    const linked = await db.prepare(`SELECT c.id FROM official_sync_changes s JOIN change_sets c ON c.id=s.change_id WHERE s.run_id=? AND c.source_url=? LIMIT 1`)
      .bind(run.id, article.source_url).first();
    if (!linked) await db.prepare("INSERT OR IGNORE INTO official_sync_source_reviews (run_id,source_url,reason,status) VALUES (?,?,'公告尚未覆盖，自动补查','queued')")
      .bind(run.id, article.source_url).run();
  }
}

async function finish(db: D1Database, run: Run, primary: AgentReport, review: AgentReport | null, budget: Budget, now: string) {
  // These states, rather than the model's claimed publication count, are authoritative.
  const outcomes = await db.prepare(`SELECT c.id AS change_set_id,c.status,c.operation,c.target_event_id,c.source_url
    FROM official_sync_changes s JOIN change_sets c ON c.id=s.change_id WHERE s.run_id=?`).bind(run.id).all();
  const sources = [...primary.source_outcomes, ...(review?.source_outcomes ?? [])];
  for (const source of sources) if (["ignored", "unchanged", "published"].includes(source.decision)) {
    const pending = await db.prepare(`SELECT c.id FROM official_sync_changes s JOIN change_sets c ON c.id=s.change_id WHERE s.run_id=? AND c.source_url=? AND c.status='proposed' LIMIT 1`)
      .bind(run.id, source.source_url).first();
    if (!pending) await db.prepare("UPDATE official_sync_source_reviews SET status='resolved' WHERE run_id=? AND source_url=?")
      .bind(run.id, source.source_url).run();
  }
  await db.prepare("UPDATE official_sync_reviews SET status='unresolved' WHERE run_id=? AND status='queued'").bind(run.id).run();
  await db.prepare("UPDATE official_sync_source_reviews SET status='unresolved' WHERE run_id=? AND status='queued'").bind(run.id).run();
  if (run.auto_publish === 1) await db.prepare(`UPDATE official_sync_sources SET processed_hash=content_hash,processed_at=?
    WHERE EXISTS (SELECT 1 FROM official_sync_run_sources rs WHERE rs.run_id=? AND rs.url=official_sync_sources.url AND rs.content_hash=official_sync_sources.content_hash)
    AND NOT EXISTS (SELECT 1 FROM official_sync_source_reviews sr WHERE sr.run_id=? AND sr.source_url=official_sync_sources.url AND sr.status='budget_stopped')
    AND NOT EXISTS (SELECT 1 FROM official_sync_reviews r JOIN change_sets c ON c.id=r.change_id WHERE r.run_id=? AND c.source_url=official_sync_sources.url AND r.status='budget_stopped')`)
    .bind(now, run.id, run.id, run.id).run();
  const saved = { ...primary, ...(review ? { automatic_review: review } : {}), budget: { group: budget.group, estimated_exposure_usd: await budget.exposure(), basis: "standard API estimate; soft budget" } };
  await db.prepare("UPDATE official_sync_runs SET status='completed',result_json=?,summary_json=?,error_code=NULL,updated_at=? WHERE id=?")
    .bind(JSON.stringify(saved), JSON.stringify(outcomes.results), now, run.id).run();
  console.log(JSON.stringify({ action: "official_sync.completed", run_id: run.id, outcomes: outcomes.results }));
}

export async function tick(env: SyncEnv, now = new Date(), trial?: TrialOptions): Promise<void> {
  if (env.SYNC_ENABLED !== "true" && env.SYNC_EVAL_ENABLED !== "true" && !trial) return;
  if (trial && !/^trial-v2-[a-z0-9-]{1,70}$/.test(trial.runId)) throw new Error("invalid_trial_id");
  if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL || !env.MCP_ENDPOINT_URL || !env.AUTOMATION_SIGNING_SECRET
    || new TextEncoder().encode(env.AUTOMATION_SIGNING_SECRET).length < 32) throw new Error("sync_configuration_missing");
  if (Boolean(env.MCP_ACCESS_CLIENT_ID) !== Boolean(env.MCP_ACCESS_CLIENT_SECRET)) throw new Error("sync_configuration_missing");
  const endpoint = new URL(env.MCP_ENDPOINT_URL);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.hostname === "mcp.example.com" || endpoint.pathname !== "/mcp") throw new Error("sync_configuration_missing");
  const owner = crypto.randomUUID();
  const acquired = await env.DB.prepare(`INSERT INTO official_sync_lease (id,owner,expires_at) VALUES (1,?,?)
    ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE official_sync_lease.expires_at<?`)
    .bind(owner, now.valueOf() + 900_000, now.valueOf()).run();
  if (!acquired.meta.changes) return;
  const client = new AgentsClient(env.OPENAI_API_KEY);
  let run: Run | null = null, budget: Budget | null = null, step = "load_run";
  try {
    if (env.SYNC_EVAL_ENABLED === "true" && await tickEvaluations(env.DB, client, env.SYNC_BUDGET_GROUP)) return;
    if (env.SYNC_ENABLED !== "true" && !trial) return;
    const day = new Date(now.valueOf() + 9 * 3_600_000).toISOString().slice(0, 10);
    const desiredId = trial?.runId ?? `official-${day}`;
    run = trial
      ? await env.DB.prepare("SELECT * FROM official_sync_runs WHERE id=?").bind(desiredId).first<Run>()
      : await env.DB.prepare("SELECT * FROM official_sync_runs WHERE status IN ('starting','running','applying') LIMIT 1").first<Run>();
    if (run && !["starting", "running", "applying"].includes(run.status)) return;
    if (!run) {
      const autoPublish = trial?.draftOnly ? false : env.SYNC_AUTO_PUBLISH === "true";
      const group = env.SYNC_BUDGET_GROUP || `daily:${day}`;
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO official_sync_runs (id,status,auto_publish,policy_version,budget_group,created_at,updated_at)
        VALUES (?,'starting',?,?,?,?,?)`).bind(desiredId, autoPublish ? 1 : 0, SYNC_POLICY_VERSION, group, now.toISOString(), now.toISOString()).run();
      if (!inserted.meta.changes) return;
      run = await env.DB.prepare("SELECT * FROM official_sync_runs WHERE id=?").bind(desiredId).first<Run>();
      if (!run) throw new Error("run_creation_failed");
    }
    budget = new Budget(env.DB, run.budget_group || env.SYNC_BUDGET_GROUP || `daily:${day}`, Number(env.SYNC_BUDGET_USD || 1));
    await budget.initialize();
    if (now.valueOf() - Date.parse(run.created_at) > 3_600_000 || run.stop_requested) {
      await cancel(client, run.session_id); await cancel(client, run.review_session_id);
      await env.DB.prepare("UPDATE official_sync_runs SET status='failed',error_code=?,updated_at=? WHERE id=?")
        .bind(run.stop_requested ? "tool_budget_exceeded" : "run_expired", now.toISOString(), run.id).run(); return;
    }
    if (run.status === "starting") {
      step = "prepare_input";
      if (!run.input_json) {
        const discovery = env.SYNC_DISCOVERY_ENABLED === "false" ? { articles: [], errors: [] } : await discover(env.DB, run.id, now, trial?.forceSources);
        if (!discovery.articles.length && env.SYNC_DISCOVERY_ENABLED !== "false") {
          await env.DB.prepare("UPDATE official_sync_runs SET status='completed',result_json=?,summary_json='[]',updated_at=? WHERE id=?")
            .bind(JSON.stringify({ summary: "未发现可读取的新公告或正文变化，未调用模型", notes: discovery.errors }), now.toISOString(), run.id).run(); return;
        }
        const manifest: Manifest = { model: env.OPENAI_MODEL, mcp_url: env.MCP_ENDPOINT_URL, auto_publish: run.auto_publish === 1, prompt: instructions,
          input: { today: now.toISOString(), lookback_days: DISCOVERY_LOOKBACK_DAYS, run_id: run.id, auto_publish: run.auto_publish === 1,
            articles: discovery.articles, source_errors: discovery.errors } };
        run.input_json = JSON.stringify(manifest);
        await env.DB.prepare("UPDATE official_sync_runs SET input_json=? WHERE id=?").bind(run.input_json, run.id).run();
      }
      const manifest = JSON.parse(run.input_json) as Manifest;
      if (!await budget.reserve(`${run.id}:primary`, manifest.model, 0.2)) throw new Error("soft_budget_exhausted");
      step = "start_agent";
      const session = await startSession(client, env, run, manifest, "primary"); await budget.attach(`${run.id}:primary`, session);
      await env.DB.prepare("UPDATE official_sync_runs SET session_id=?,status='running',updated_at=? WHERE id=?")
        .bind(session, now.toISOString(), run.id).run();
      console.log(JSON.stringify({ action: "official_sync.started", run_id: run.id, session_id: session, model: manifest.model })); return;
    }
    const manifest = JSON.parse(run.input_json!) as Manifest;
    if (!run.primary_done) {
      step = "collect_agent";
      const progress = await client.progress(run.session_id!); await budget.record(run.session_id!, manifest.model, progress);
      if (await budget.exceeded()) { await cancel(client, run.session_id); throw new Error("soft_budget_exhausted"); }
      if (progress.state === "running") return;
      if (progress.state === "failed") throw new Error("agent_turn_failed");
      const primary = report(progress); run.result_json = JSON.stringify(primary); run.primary_done = 1;
      await env.DB.prepare("UPDATE official_sync_runs SET primary_done=1,result_json=?,updated_at=? WHERE id=?").bind(run.result_json, now.toISOString(), run.id).run();
      await budget.close(`${run.id}:primary`); await queueReviews(env.DB, run, primary, manifest);
    }
    const primary = agentReportSchema.parse(JSON.parse(run.result_json!)) as AgentReport;
    // Restore observational metadata; schema parsing above intentionally validates only the model contract.
    const primaryWithUsage = { ...JSON.parse(run.result_json!), ...primary } as AgentReport;
    const changes = await env.DB.prepare("SELECT change_id FROM official_sync_reviews WHERE run_id=? AND status='queued'").bind(run.id).all<{ change_id: string }>();
    const sources = await env.DB.prepare("SELECT source_url FROM official_sync_source_reviews WHERE run_id=? AND status='queued'").bind(run.id).all<{ source_url: string }>();
    if ((changes.results.length || sources.results.length) && !run.review_session_id && !run.review_report_json) {
      step = "start_review";
      if (!run.review_input_json) {
        const review: Manifest = { model: env.OPENAI_REVIEW_MODEL || "gpt-6.1-sol", mcp_url: manifest.mcp_url, auto_publish: run.auto_publish === 1, prompt: reviewInstructions,
          input: { today: now.toISOString(), lookback_days: DISCOVERY_LOOKBACK_DAYS, run_id: run.id, auto_publish: run.auto_publish === 1,
            review_change_ids: changes.results.map((item) => item.change_id), review_source_urls: sources.results.map((item) => item.source_url) } };
        run.review_input_json = JSON.stringify(review);
        await env.DB.prepare("UPDATE official_sync_runs SET review_attempted=1,review_input_json=? WHERE id=?").bind(run.review_input_json, run.id).run();
      }
      const review = JSON.parse(run.review_input_json) as Manifest;
      if (!await budget.reserve(`${run.id}:review`, review.model, 0.35)) {
        await env.DB.prepare("UPDATE official_sync_reviews SET status='budget_stopped' WHERE run_id=? AND status='queued'").bind(run.id).run();
        await env.DB.prepare("UPDATE official_sync_source_reviews SET status='budget_stopped' WHERE run_id=? AND status='queued'").bind(run.id).run();
        await finish(env.DB, run, primaryWithUsage, null, budget, now.toISOString()); return;
      }
      const session = await startSession(client, env, run, review, "review"); await budget.attach(`${run.id}:review`, session);
      await env.DB.prepare("UPDATE official_sync_runs SET review_session_id=?,updated_at=? WHERE id=?").bind(session, now.toISOString(), run.id).run();
      console.log(JSON.stringify({ action: "official_sync.review_started", run_id: run.id, session_id: session, model: review.model })); return;
    }
    if (run.review_session_id && !run.review_report_json) {
      step = "collect_review";
      const review = JSON.parse(run.review_input_json!) as Manifest;
      const progress = await client.progress(run.review_session_id); await budget.record(run.review_session_id, review.model, progress);
      if (await budget.exceeded()) { await cancel(client, run.review_session_id); throw new Error("soft_budget_exhausted"); }
      if (progress.state === "running") return;
      if (progress.state === "failed") throw new Error("review_turn_failed");
      run.review_report_json = JSON.stringify(report(progress));
      await env.DB.prepare("UPDATE official_sync_runs SET review_report_json=?,updated_at=? WHERE id=?").bind(run.review_report_json, now.toISOString(), run.id).run();
      await budget.close(`${run.id}:review`);
    }
    await finish(env.DB, run, primaryWithUsage, run.review_report_json ? JSON.parse(run.review_report_json) as AgentReport : null, budget, now.toISOString());
  } catch (error) {
    const code = error instanceof Error && /^(openai_http_\d{3}|openai_key_format_invalid|agent_turn_failed|review_turn_failed|agent_output_missing|soft_budget_exhausted|budget_model_unconfigured)$/.test(error.message)
      ? error.message : "sync_step_failed";
    if (run) {
      const failed = run.attempts >= 4 || ["agent_turn_failed", "review_turn_failed", "agent_output_missing", "soft_budget_exhausted", "budget_model_unconfigured", "openai_key_format_invalid"].includes(code)
        || /^openai_http_4(?!29)/.test(code);
      if (failed) { await cancel(client, run.session_id); await cancel(client, run.review_session_id); }
      await env.DB.prepare("UPDATE official_sync_runs SET attempts=attempts+1,error_code=?,status=CASE WHEN ? THEN 'failed' ELSE status END,updated_at=? WHERE id=?")
        .bind(code, failed ? 1 : 0, now.toISOString(), run.id).run();
      if (failed && budget) { await budget.close(`${run.id}:primary`); await budget.close(`${run.id}:review`); }
    }
    const errorName = error instanceof Error && ["Error", "TypeError", "SyntaxError", "ZodError", "AbortError", "TimeoutError"].includes(error.name) ? error.name : "unknown";
    console.error(JSON.stringify({ action: "official_sync.error", run_id: run?.id, code, step, error_name: errorName }));
    throw new Error(code);
  } finally { await env.DB.prepare("DELETE FROM official_sync_lease WHERE id=1 AND owner=?").bind(owner).run(); }
}

export default {
  async fetch(): Promise<Response> { return new Response("Not found", { status: 404 }); },
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil((async () => {
      await safeTickNotifications(env);
      try { await tick(env); }
      finally { await safeTickNotifications(env); }
    })());
  },
} satisfies ExportedHandler<SyncEnv>;
