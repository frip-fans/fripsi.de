import { z } from "zod";
import { AgentsClient } from "./agent";
import { Budget } from "./budget";
import { evaluationSchema, scoreEvaluation } from "./eval-cases";

interface EvaluationJob { id: string; budget_group: string; model: string; status: string; input_json: string; session_id: string | null; created_at: string }
export async function tickEvaluations(db: D1Database, client: AgentsClient, group?: string): Promise<boolean> {
  const job = await db.prepare("SELECT * FROM official_sync_evaluations WHERE status IN ('starting','running','queued') AND (? IS NULL OR budget_group=?) ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'starting' THEN 1 ELSE 2 END,created_at,id LIMIT 1")
    .bind(group ?? null, group ?? null).first<EvaluationJob>();
  if (!job) return false;
  const budget = new Budget(db, job.budget_group, 1), now = new Date().toISOString();
  try {
    if (Date.now() - Date.parse(job.created_at) > 45 * 60_000) throw new Error("evaluation_expired");
    if (job.status !== "running") {
      if (!await budget.reserve(job.id, job.model, job.model === "gpt-6.1-sol" ? 0.2 : 0.05)) {
        await db.prepare("UPDATE official_sync_evaluations SET status='budget_stopped',updated_at=? WHERE id=?").bind(now, job.id).run(); return true;
      }
      await db.prepare("UPDATE official_sync_evaluations SET status='starting',updated_at=? WHERE id=?").bind(now, job.id).run();
      const manifest = JSON.parse(job.input_json) as { input: unknown; prompt: string };
      const session = await client.startEvaluation(job.model, manifest.input, job.id, z.toJSONSchema(evaluationSchema), manifest.prompt);
      await budget.attach(job.id, session);
      await db.prepare("UPDATE official_sync_evaluations SET status='running',session_id=?,updated_at=? WHERE id=?").bind(session, now, job.id).run();
      return true;
    }
    const progress = await client.progress(job.session_id!); await budget.record(job.session_id!, job.model, progress);
    if (await budget.exceeded()) {
      await client.call(`sessions/${encodeURIComponent(job.session_id!)}/events`, { events: [{ type: "agent.session.input.cancel" }] });
      await db.prepare("UPDATE official_sync_evaluations SET status='budget_stopped',updated_at=? WHERE id=?").bind(now, job.id).run(); await budget.close(job.id); return true;
    }
    if (progress.state === "running") return true;
    if (progress.state === "failed") throw new Error("evaluation_turn_failed");
    const score = scoreEvaluation(progress.output);
    await db.prepare("UPDATE official_sync_evaluations SET status='completed',result_json=?,score_json=?,updated_at=? WHERE id=?")
      .bind(JSON.stringify({ output: progress.output, usage: progress.usage, tools: progress.tools }), JSON.stringify(score), now, job.id).run();
    await budget.close(job.id);
    console.log(JSON.stringify({ action: "official_sync.evaluation_completed", job_id: job.id, model: job.model, passed: score.passed, total: score.total }));
  } catch (error) {
    const code = error instanceof Error && /^(openai_http_\d{3}|evaluation_expired|evaluation_turn_failed)$/.test(error.message) ? error.message : "evaluation_step_failed";
    await db.prepare("UPDATE official_sync_evaluations SET status='failed',error_code=?,updated_at=? WHERE id=?").bind(code, now, job.id).run();
    if (job.session_id) { try { await client.call(`sessions/${encodeURIComponent(job.session_id)}/events`, { events: [{ type: "agent.session.input.cancel" }] }); } catch { /* Best effort. */ } }
    await budget.close(job.id); console.error(JSON.stringify({ action: "official_sync.evaluation_failed", job_id: job.id, code }));
  }
  return true;
}
