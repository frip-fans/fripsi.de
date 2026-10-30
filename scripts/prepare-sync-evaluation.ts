import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "@frip-fan/core";
import { evaluationCases, evaluationInput, evaluationInstructions } from "../apps/sync/src/eval-cases";

const directory = resolve(".cache/sync-v2-evaluation");
const group = process.argv[2] || `sync-v2-evaluation-${new Date().toISOString().slice(0, 10)}`;
if (!/^[a-z0-9-]{1,100}$/.test(group)) throw new Error("invalid_budget_group");
const input = evaluationInput(), manifest = JSON.stringify({ input, prompt: evaluationInstructions });
const fingerprint = (await sha256(manifest)).slice(0, 12), now = new Date().toISOString();
const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;
const statements = [`INSERT OR IGNORE INTO official_sync_budgets (id,limit_usd,created_at) VALUES (${sql(group)},1,${sql(now)});`];
for (const model of ["gpt-6-luna", "gpt-6.1-sol"]) {
  const id = `${group}-${model}-${fingerprint}`;
  statements.push(`INSERT OR IGNORE INTO official_sync_evaluations (id,budget_group,model,status,input_json,created_at,updated_at) VALUES (${sql(id)},${sql(group)},${sql(model)},'queued',${sql(manifest)},${sql(now)},${sql(now)});`);
}
await mkdir(directory, { recursive: true });
const file = resolve(directory, "plan.sql");
await writeFile(file, statements.join("\n"), { mode: 0o600 });
await writeFile(resolve(directory, "plan.json"), JSON.stringify({ group, fingerprint, cases: evaluationCases.length, models: ["gpt-6-luna", "gpt-6.1-sol"], created_at: now }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ sql_file: file, budget_group: group, soft_limit_usd: 1, cases: evaluationCases.length, jobs: 2, fingerprint }));
