import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

throw new Error("此一次性字段补全生成器使用已移除的 events.venue/region schema；0004 后请通过结构化 Admin/MCP 更新地点。");

const VERIFIED_AT = "2026-07-19T03:30:00.000Z";
const REVIEW_ROOT = process.argv[2] ? resolve(process.argv[2]) : "/tmp";
const CURRENT_EVENTS_PATH = process.argv[3]
  ? resolve(process.argv[3])
  : "/tmp/fripside-local-events-2022-2025.json";
const NORMALIZED_ROOT = resolve("data/normalized");
const REPORT_ROOT = resolve("data/reports");
const IMPORT_ACTOR = "official-field-completion-2022-2027";
const ALLOWED_UPDATE_FIELDS = new Set([
  "title",
  "start_date",
  "end_date",
  "start_time",
  "end_time",
  "timezone",
  "category",
  "classification",
  "venue",
  "region",
  "remark",
  "status"
]);

const hash = (value, length = 24) => createHash("sha256").update(value).digest("hex").slice(0, length);
const unique = (items) => [...new Set(items.filter(Boolean))];
const confidenceScore = (value) => {
  if (typeof value === "number") return value;
  return {
    high: 1,
    "medium-high": 0.85,
    medium: 0.7,
    low: 0.4
  }[String(value).toLowerCase()] ?? 0;
};
const sqlValue = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
};
const asciiSlug = (value) => value
  .normalize("NFKD")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 72);
const addUtcDays = (date, days) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const normalizeRegion = (value) => String(value).replaceAll("オンライン", "在线");
const sourceLabel = (url) => {
  const host = new URL(url).hostname;
  if (host === "fripside.net") return "fripSide official news";
  if (host === "wmg.jp") return "Warner Music Japan official news";
  if (host === "nbcuni-music.com") return "NBCUniversal fripSide official news";
  return host;
};
const sourceType = (url) => {
  const host = new URL(url).hostname;
  if (host === "web.archive.org") return "archive";
  if (host.endsWith("eventernote.com") || host.endsWith("art-mate.net")) return "secondary";
  return "official";
};

const currentRaw = JSON.parse(await readFile(CURRENT_EVENTS_PATH, "utf8"));
const currentEvents = Array.isArray(currentRaw) && currentRaw[0]?.results
  ? currentRaw[0].results
  : currentRaw;
if (!Array.isArray(currentEvents)) throw new Error("Current event export must be an array or Wrangler JSON result");
const currentById = new Map(currentEvents.map((event) => [event.id, event]));

const auditPaths = [
  "fripside-field-audit-2022.json",
  "fripside-field-audit-2022-media-second-pass.json",
  "fripside-field-audit-2023.json",
  "fripside-field-audit-2024-2025.json",
  "fripside-field-audit-2024-media-second-pass.json",
  "fripside-field-audit-2025-media-second-pass.json"
].map((file) => resolve(REVIEW_ROOT, file));
const audits = [];
for (const path of auditPaths) {
  const audit = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(audit.updates) || !Array.isArray(audit.unresolved)) {
    throw new Error(`${basename(path)} must contain updates and unresolved arrays`);
  }
  audits.push({ path, audit });
}

const mergedUpdates = new Map();
for (const { path, audit } of audits) {
  for (const raw of audit.updates) {
    if (!raw.id || !raw.proposed || !Array.isArray(raw.source_urls) || raw.source_urls.length === 0) {
      throw new Error(`Incomplete update in ${basename(path)}: ${JSON.stringify(raw)}`);
    }
    const current = currentById.get(raw.id);
    if (!current) throw new Error(`Unknown event id in ${basename(path)}: ${raw.id}`);

    const proposed = {};
    for (const [field, rawValue] of Object.entries(raw.proposed)) {
      // Event slugs are public permalinks. Keep them stable even when a legacy date is corrected.
      if (field === "slug") continue;
      if (!ALLOWED_UPDATE_FIELDS.has(field)) throw new Error(`Unsupported update field ${field} for ${raw.id}`);
      if (rawValue === null || rawValue === undefined || rawValue === "") continue;
      const value = field === "region" ? normalizeRegion(rawValue) : rawValue;
      if (current[field] !== value) proposed[field] = value;
    }
    const finalStartTime = proposed.start_time ?? current.start_time;
    const finalEndTime = proposed.end_time ?? current.end_time;
    const finalStartDate = proposed.start_date ?? current.start_date;
    const finalEndDate = proposed.end_date ?? current.end_date;
    if (finalStartTime && finalEndTime && finalEndTime <= finalStartTime && !finalEndDate) {
      proposed.end_date = addUtcDays(finalStartDate, 1);
    }
    if (Object.keys(proposed).length === 0) continue;

    const previous = mergedUpdates.get(raw.id);
    if (previous) {
      for (const [field, value] of Object.entries(proposed)) {
        if (field in previous.proposed && previous.proposed[field] !== value) {
          throw new Error(`Conflicting ${field} proposals for ${raw.id}`);
        }
      }
    }
    mergedUpdates.set(raw.id, {
      id: raw.id,
      current,
      proposed: { ...(previous?.proposed ?? {}), ...proposed },
      source_urls: unique([...(previous?.source_urls ?? []), ...raw.source_urls]),
      evidence: unique([...(previous?.evidence ?? []), raw.evidence]),
      confidence: Math.max(confidenceScore(previous?.confidence), confidenceScore(raw.confidence)),
      audit_files: unique([...(previous?.audit_files ?? []), basename(path)])
    });
  }
}

const updates = [...mergedUpdates.values()].sort((left, right) => (
  left.current.start_date.localeCompare(right.current.start_date) || left.id.localeCompare(right.id)
));

const invalidRecords = audits.flatMap(({ path, audit }) => (audit.invalid_records ?? []).map((record) => ({
  ...record,
  audit_file: basename(path)
})));
for (const record of invalidRecords) {
  if (!record.id || record.action !== "archive" || !currentById.has(record.id)) {
    throw new Error(`Invalid archive proposal: ${JSON.stringify(record)}`);
  }
}

const finalSlugs = new Map();
for (const event of currentEvents) {
  if (invalidRecords.some((record) => record.id === event.id)) continue;
  const slug = mergedUpdates.get(event.id)?.proposed.slug ?? event.slug;
  const conflict = finalSlugs.get(slug);
  if (conflict && conflict !== event.id) throw new Error(`Duplicate final slug ${slug}: ${conflict} / ${event.id}`);
  finalSlugs.set(slug, event.id);
}

const liveAudit = JSON.parse(await readFile(resolve(REVIEW_ROOT, "fripside-live-2027-01.json"), "utf8"));
const liveCandidate = liveAudit.candidates?.[0];
if (!liveCandidate || liveCandidate.action !== "create" || liveCandidate.start_date !== "2027-01-11") {
  throw new Error("The January 2027 LIVE audit must contain the confirmed create candidate");
}
const liveTitle = "「animeblast presents fripSide Concert Tour 2026-2027 -infinite Resonance 4-」@東京・TACHIKAWA STAGE GARDEN";
const liveSeed = `${liveCandidate.start_date}|${liveCandidate.start_time}|${liveTitle}`;
const createdEvent = {
  id: `evt_official_${hash(liveSeed)}`,
  slug: `${liveCandidate.start_date}-${asciiSlug(liveTitle)}-${hash(liveSeed, 8)}`,
  title: liveTitle,
  start_date: liveCandidate.start_date,
  end_date: liveCandidate.end_date ?? null,
  start_time: liveCandidate.start_time,
  end_time: liveCandidate.end_time ?? null,
  timezone: liveCandidate.timezone ?? "Asia/Tokyo",
  category: "LIVE",
  classification: liveCandidate.classification ?? "专场",
  venue: liveCandidate.venue,
  region: normalizeRegion(liveCandidate.region),
  remark: liveCandidate.remark,
  status: liveCandidate.status,
  published: true,
  sources: unique(liveCandidate.source_urls)
};

if (currentEvents.some((event) => event.id === createdEvent.id) || finalSlugs.has(createdEvent.slug)) {
  throw new Error(`January 2027 LIVE conflicts with an existing local event: ${createdEvent.id}`);
}

const profileCompleteness = (events) => {
  const groups = new Map();
  for (const event of events) {
    const key = `${event.start_date.slice(0, 4)}|${event.category}`;
    const group = groups.get(key) ?? {
      year: event.start_date.slice(0, 4),
      category: event.category,
      total: 0,
      missing_time: 0,
      missing_venue: 0,
      missing_region: 0
    };
    group.total += 1;
    if (!event.start_time) group.missing_time += 1;
    if (!event.venue) group.missing_venue += 1;
    if (!event.region) group.missing_region += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => (
    left.year.localeCompare(right.year) || left.category.localeCompare(right.category)
  ));
};
const invalidIds = new Set(invalidRecords.map((record) => record.id));
const afterEvents = currentEvents
  .filter((event) => !invalidIds.has(event.id))
  .map((event) => ({ ...event, ...(mergedUpdates.get(event.id)?.proposed ?? {}) }));
const afterById = new Map(afterEvents.map((event) => [event.id, event]));
const unresolvedGroups = [];
const unresolvedById = new Map();
for (const { path, audit } of audits) {
  for (const item of audit.unresolved) {
    const annotated = { audit_file: basename(path), ...item };
    if (!item.id || !Array.isArray(item.missing_fields)) {
      unresolvedGroups.push(annotated);
      continue;
    }
    const finalEvent = afterById.get(item.id);
    const missingFields = item.missing_fields.filter((field) => !finalEvent?.[field]);
    if (missingFields.length === 0) continue;
    // A later, focused audit supersedes the preliminary unresolved explanation.
    unresolvedById.set(item.id, { ...annotated, missing_fields: missingFields });
  }
}
const unresolved = [...unresolvedGroups, ...unresolvedById.values()];

const sql = ["PRAGMA foreign_keys = ON;", ""];
for (const update of updates) {
  const assignments = Object.entries(update.proposed).map(([field, value]) => `  ${field} = ${sqlValue(value)}`);
  assignments.push("  version = version + 1", `  updated_at = ${sqlValue(VERIFIED_AT)}`);
  const differences = Object.entries(update.proposed).map(([field, value]) => `${field} IS NOT ${sqlValue(value)}`);
  sql.push(
    `UPDATE events SET\n${assignments.join(",\n")}\nWHERE id = ${sqlValue(update.id)} AND (${differences.join(" OR ")});`,
    ""
  );

  for (const url of update.source_urls) {
    sql.push(
      "INSERT OR IGNORE INTO event_sources (id, event_id, url, label, source_type, verified_at, created_at, created_by)",
      `VALUES (${[
        `src_field_${hash(`${update.id}|${url}`)}`,
        update.id,
        url,
        sourceLabel(url),
        sourceType(url),
        VERIFIED_AT,
        VERIFIED_AT,
        IMPORT_ACTOR
      ].map(sqlValue).join(", ")});`,
      ""
    );
  }

  const auditId = `aud_field_${hash(`${update.id}|${JSON.stringify(update.proposed)}`)}`;
  const after = { ...update.current, ...update.proposed };
  sql.push(
    "INSERT OR IGNORE INTO audit_logs (id, actor_id, actor_type, channel, action, target_type, target_id, request_id, before_json, after_json, metadata_json, created_at)",
    `VALUES (${[
      auditId,
      IMPORT_ACTOR,
      "system",
      "import",
      "event.update",
      "event",
      update.id,
      `req_${hash(auditId)}`,
      JSON.stringify(update.current),
      JSON.stringify(after),
      JSON.stringify({
        changed_fields: Object.keys(update.proposed),
        source_urls: update.source_urls,
        confidence: update.confidence,
        evidence: update.evidence,
        audit_files: update.audit_files
      }),
      VERIFIED_AT
    ].map(sqlValue).join(", ")});`,
    ""
  );
}

for (const record of invalidRecords) {
  const current = currentById.get(record.id);
  sql.push(
    "UPDATE events SET",
    "  published = 0,",
    `  archived_at = ${sqlValue(VERIFIED_AT)},`,
    "  version = version + 1,",
    `  updated_at = ${sqlValue(VERIFIED_AT)}`,
    `WHERE id = ${sqlValue(record.id)} AND (published IS NOT 0 OR archived_at IS NULL);`,
    ""
  );
  const auditId = `aud_field_${hash(`archive|${record.id}`)}`;
  sql.push(
    "INSERT OR IGNORE INTO audit_logs (id, actor_id, actor_type, channel, action, target_type, target_id, request_id, before_json, after_json, metadata_json, created_at)",
    `VALUES (${[
      auditId,
      IMPORT_ACTOR,
      "system",
      "import",
      "event.archive",
      "event",
      record.id,
      `req_${hash(auditId)}`,
      JSON.stringify(current),
      JSON.stringify({ ...current, published: 0, archived_at: VERIFIED_AT }),
      JSON.stringify({
        finding: record.finding,
        evidence: record.evidence,
        source_urls: record.source_urls ?? [],
        confidence: record.confidence,
        audit_file: record.audit_file
      }),
      VERIFIED_AT
    ].map(sqlValue).join(", ")});`,
    ""
  );
}

sql.push(
  "INSERT INTO events (",
  "  id, slug, title, start_date, end_date, start_time, end_time, timezone, category,",
  "  classification, venue, region, remark, status, published, version, created_at, updated_at, published_at, archived_at",
  `) VALUES (${[
    createdEvent.id,
    createdEvent.slug,
    createdEvent.title,
    createdEvent.start_date,
    createdEvent.end_date,
    createdEvent.start_time,
    createdEvent.end_time,
    createdEvent.timezone,
    createdEvent.category,
    createdEvent.classification,
    createdEvent.venue,
    createdEvent.region,
    createdEvent.remark,
    createdEvent.status,
    true,
    1,
    VERIFIED_AT,
    VERIFIED_AT,
    VERIFIED_AT,
    null
  ].map(sqlValue).join(", ")})`,
  "ON CONFLICT(id) DO UPDATE SET",
  "  slug = excluded.slug,",
  "  title = excluded.title,",
  "  start_date = excluded.start_date,",
  "  end_date = excluded.end_date,",
  "  start_time = excluded.start_time,",
  "  end_time = excluded.end_time,",
  "  timezone = excluded.timezone,",
  "  category = excluded.category,",
  "  classification = excluded.classification,",
  "  venue = excluded.venue,",
  "  region = excluded.region,",
  "  remark = excluded.remark,",
  "  status = excluded.status,",
  "  published = excluded.published,",
  "  version = events.version + 1,",
  "  updated_at = excluded.updated_at,",
  "  published_at = COALESCE(events.published_at, excluded.published_at),",
  "  archived_at = NULL",
  "WHERE events.slug IS NOT excluded.slug OR events.title IS NOT excluded.title OR events.start_date IS NOT excluded.start_date OR events.end_date IS NOT excluded.end_date OR events.start_time IS NOT excluded.start_time OR events.end_time IS NOT excluded.end_time OR events.timezone IS NOT excluded.timezone OR events.category IS NOT excluded.category OR events.classification IS NOT excluded.classification OR events.venue IS NOT excluded.venue OR events.region IS NOT excluded.region OR events.remark IS NOT excluded.remark OR events.status IS NOT excluded.status OR events.published IS NOT excluded.published;",
  ""
);

for (const url of createdEvent.sources) {
  sql.push(
    "INSERT OR IGNORE INTO event_sources (id, event_id, url, label, source_type, verified_at, created_at, created_by)",
    `VALUES (${[
      `src_field_${hash(`${createdEvent.id}|${url}`)}`,
      createdEvent.id,
      url,
      sourceLabel(url),
      sourceType(url),
      VERIFIED_AT,
      VERIFIED_AT,
      IMPORT_ACTOR
    ].map(sqlValue).join(", ")});`,
    ""
  );
}

const createAuditId = `aud_field_${hash(`create|${createdEvent.id}`)}`;
sql.push(
  "INSERT OR IGNORE INTO audit_logs (id, actor_id, actor_type, channel, action, target_type, target_id, request_id, before_json, after_json, metadata_json, created_at)",
  `VALUES (${[
    createAuditId,
    IMPORT_ACTOR,
    "system",
    "import",
    "event.create",
    "event",
    createdEvent.id,
    `req_${hash(createAuditId)}`,
    null,
    JSON.stringify(createdEvent),
    JSON.stringify({ source_urls: createdEvent.sources, confidence: liveCandidate.confidence }),
    VERIFIED_AT
  ].map(sqlValue).join(", ")});`,
  ""
);

const summary = {
  generated_at: VERIFIED_AT,
  purpose: "Complete verified dates, times, venues and regions for 2022-2025 events; add the missing January 2027 tour stop.",
  current_event_rows_reviewed: currentEvents.length,
  audit_files: audits.map(({ path }) => basename(path)),
  updates: updates.length,
  updated_fields: updates.reduce((counts, update) => {
    for (const field of Object.keys(update.proposed)) counts[field] = (counts[field] ?? 0) + 1;
    return counts;
  }, {}),
  created: 1,
  archived_invalid_imports: invalidRecords.length,
  invalid_records: invalidRecords,
  quality_profile: {
    grain: "one event occurrence per events.id",
    before: profileCompleteness(currentEvents),
    after: profileCompleteness(afterEvents),
    remaining_live_required_field_issues: afterEvents
      .filter((event) => event.category === "LIVE" && (!event.start_time || !event.venue || !event.region))
      .map((event) => ({ id: event.id, title: event.title, start_date: event.start_date })),
    remaining_event_location_issues: afterEvents
      .filter((event) => event.category === "EVENT" && (!event.venue || !event.region))
      .map((event) => ({ id: event.id, title: event.title, start_date: event.start_date }))
  },
  created_event: createdEvent,
  unresolved,
  update_details: updates.map(({ current, ...update }) => ({
    ...update,
    start_date: current.start_date,
    title: current.title
  }))
};

const importJobId = `imp_field_${hash(JSON.stringify({ updates: summary.update_details, createdEvent }))}`;
const importJobReport = {
  generated_at: summary.generated_at,
  purpose: summary.purpose,
  audit_files: summary.audit_files,
  updates: summary.updates,
  updated_fields: summary.updated_fields,
  created: summary.created,
  archived_invalid_imports: summary.archived_invalid_imports,
  quality_profile: summary.quality_profile,
  created_event: summary.created_event,
  unresolved: summary.unresolved
};
sql.push(
  "INSERT OR IGNORE INTO import_jobs (id, filename, status, total_rows, valid_rows, invalid_rows, report_json, created_by, created_at, imported_at)",
  `VALUES (${[
    importJobId,
    "fripside-official-field-completion-2022-2027.json",
    "imported",
    updates.length + invalidRecords.length + 1,
    updates.length + invalidRecords.length + 1,
    0,
    JSON.stringify(importJobReport),
    IMPORT_ACTOR,
    VERIFIED_AT,
    VERIFIED_AT
  ].map(sqlValue).join(", ")});`,
  ""
);

await mkdir(NORMALIZED_ROOT, { recursive: true });
await mkdir(REPORT_ROOT, { recursive: true });
const sqlPath = resolve(NORMALIZED_ROOT, "fripside-official-field-completion-2022-2027.sql");
const normalizedPath = resolve(NORMALIZED_ROOT, "fripside-official-field-completion-2022-2027.json");
const reportPath = resolve(REPORT_ROOT, "fripside-official-field-completion-2022-2027-summary.json");
await writeFile(sqlPath, `${sql.join("\n")}\n`);
await writeFile(normalizedPath, `${JSON.stringify({ updates, creates: [createdEvent] }, null, 2)}\n`);
await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(JSON.stringify({ sqlPath, normalizedPath, reportPath, summary }, null, 2));
