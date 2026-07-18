import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface ImportEvent {
  id: string; slug: string; title: string; start_date: string; end_date: string | null;
  start_time: string | null; end_time: string | null; timezone: string; category: string;
  classification: string | null; venue: string | null; region: string | null; remark: string | null;
  status: string; published: boolean; source_url: string | null; source_label: string | null;
}

function sql(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stableId(value: string, prefix: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

const inputPath = resolve(process.argv[2] || "data/normalized/events.json");
const outputPath = resolve(process.argv[3] || "data/normalized/import.sql");
const events = JSON.parse(await readFile(inputPath, "utf8")) as ImportEvent[];
const now = new Date().toISOString();
const statements = ["PRAGMA foreign_keys = ON;", "BEGIN TRANSACTION;"];

for (const event of events) {
  statements.push(`INSERT OR IGNORE INTO events (
  id, slug, title, start_date, end_date, start_time, end_time, timezone, category,
  classification, venue, region, remark, status, published, version, created_at, updated_at, published_at, archived_at
) VALUES (${[
    event.id, event.slug, event.title, event.start_date, event.end_date, event.start_time, event.end_time,
    event.timezone, event.category, event.classification, event.venue, event.region, event.remark, event.status,
    event.published ? 1 : 0, 1, now, now, event.published ? now : null, null
  ].map(sql).join(", ")});`);
  if (event.source_url) {
    statements.push(`INSERT OR IGNORE INTO event_sources (id, event_id, url, label, source_type, verified_at, created_at, created_by)
VALUES (${[stableId(`${event.id}|${event.source_url}`, "src_legacy"), event.id, event.source_url, event.source_label, "legacy-import", null, now, "notion-import"].map(sql).join(", ")});`);
  }
  statements.push(`INSERT OR IGNORE INTO audit_logs (id, actor_id, actor_type, channel, action, target_type, target_id, request_id, before_json, after_json, metadata_json, created_at)
VALUES (${[
    stableId(event.id, "aud_import"), "notion-import", "system", "import", "event.import", "event", event.id,
    stableId(event.id, "req_import"), null, JSON.stringify(event), JSON.stringify({ source: "notion-csv", source_url: event.source_url }), now
  ].map(sql).join(", ")});`);
}
statements.push("COMMIT;");

await mkdir(resolve("data/normalized"), { recursive: true });
await writeFile(outputPath, `${statements.join("\n\n")}\n`, "utf8");
console.log(`已为 ${events.length} 条活动生成 ${outputPath}`);
console.log("本地导入：npx wrangler d1 execute frip-fan-dev --local --config apps/web/wrangler.jsonc --file data/normalized/import.sql");
