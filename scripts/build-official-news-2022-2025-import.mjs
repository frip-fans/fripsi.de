import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const YEARS = [2022, 2023, 2024, 2025];
const VERIFIED_AT = "2026-07-19T00:00:00.000Z";
const REVIEW_ROOT = process.argv[2] ? resolve(process.argv[2]) : "/tmp";
const REPORT_ROOT = resolve("data/reports");
const NORMALIZED_ROOT = resolve("data/normalized");

const hash = (value, length = 24) => createHash("sha256").update(value).digest("hex").slice(0, length);
const isPresent = (value) => value !== null && value !== undefined && value !== "";
const unique = (items) => [...new Set(items.filter(Boolean))];
const confidenceScore = (value) => {
  if (typeof value === "number") return value;
  return { high: 1, medium: 0.75, low: 0.5 }[String(value).toLowerCase()] ?? 0;
};
const normalizeTitle = (value) => value
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[「」『』【】〈〉《》“”‘’'"`~〜～・@＠:：,，.。!！?？()（）\[\]{}\s_-]+/g, "");

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

const makeSlug = (event) => {
  const base = asciiSlug(event.title) || event.category.toLowerCase();
  const suffix = hash(`${event.start_date}|${event.start_time ?? ""}|${event.title}`, 8);
  return `${event.start_date}-${base}-${suffix}`;
};

const candidateList = (review) => review.candidates ?? review.events ?? [];
const publicationDate = (article) => article.publication_date ?? article.published_date ?? null;

const normalizedExisting = (event) => ({
  id: event.id,
  slug: event.slug,
  title: event.title,
  start_date: event.start_date,
  end_date: event.end_date ?? null,
  start_time: event.start_time ?? null,
  end_time: event.end_time ?? null,
  timezone: event.timezone ?? "Asia/Tokyo",
  category: event.category,
  classification: event.classification ?? null,
  venue: event.venue ?? null,
  region: event.region ?? null,
  remark: event.remark ?? null,
  status: event.status,
  published: event.published !== false,
  sources: event.sources ?? []
});

const mergeRemark = (existingRemark, officialRemark) => {
  if (!isPresent(officialRemark)) return existingRemark ?? null;
  if (!isPresent(existingRemark)) return officialRemark;
  const existing = String(existingRemark).trim();
  const official = String(officialRemark).trim();
  if (existing.includes(official)) return existing;
  if (official.includes(existing)) return official;
  return `${existing}\n\n官方来源补充：${official}`;
};

const mergeCandidates = (current, incoming) => {
  if (!current) return { ...incoming, source_urls: unique(incoming.source_urls ?? []) };
  if (current.start_date !== incoming.start_date) {
    throw new Error(`Conflicting dates for ${current.matched_existing_id ?? current.title}: ${current.start_date} / ${incoming.start_date}`);
  }
  if (current.action !== incoming.action) {
    throw new Error(`Conflicting actions for ${current.title}: ${current.action} / ${incoming.action}`);
  }

  const currentScore = (current._review_year ?? 0) * 10 + confidenceScore(current.confidence);
  const incomingScore = (incoming._review_year ?? 0) * 10 + confidenceScore(incoming.confidence);
  const preferred = incomingScore >= currentScore ? incoming : current;
  const fallback = preferred === incoming ? current : incoming;
  const merged = { ...fallback, ...preferred };

  for (const field of ["end_date", "start_time", "end_time", "timezone", "classification", "venue", "region", "remark"]) {
    if (!isPresent(merged[field]) && isPresent(fallback[field])) merged[field] = fallback[field];
  }

  merged.source_urls = unique([...(current.source_urls ?? []), ...(incoming.source_urls ?? [])]);
  merged.confidence = Math.max(confidenceScore(current.confidence), confidenceScore(incoming.confidence));
  merged._review_years = unique([
    ...(current._review_years ?? [current._review_year]),
    ...(incoming._review_years ?? [incoming._review_year])
  ]).sort();
  return merged;
};

const reviewFiles = YEARS.map((year) => resolve(REVIEW_ROOT, `fripside-official-news-${year}-review.json`));
const reviews = [];

for (const [index, path] of reviewFiles.entries()) {
  const year = YEARS[index];
  const review = JSON.parse(await readFile(path, "utf8"));
  const articles = review.reviewed_articles ?? [];
  const urls = articles.map((article) => article.url);
  const candidates = candidateList(review);

  if (articles.length === 0 || candidates.length === 0) {
    throw new Error(`${basename(path)} must contain reviewed articles and candidates`);
  }
  if (new Set(urls).size !== urls.length) throw new Error(`${basename(path)} contains duplicate article URLs`);
  for (const article of articles) {
    if (!article.url || !article.title || !article.decision || !article.reason) {
      throw new Error(`${basename(path)} has an incomplete reviewed article: ${JSON.stringify(article)}`);
    }
    const date = publicationDate(article);
    if (date && !date.startsWith(String(year))) {
      throw new Error(`${basename(path)} contains article outside ${year}: ${date} ${article.url}`);
    }
  }
  for (const candidate of candidates) {
    for (const field of ["title", "start_date", "timezone", "category", "status", "action"]) {
      if (!isPresent(candidate[field])) throw new Error(`${basename(path)} candidate is missing ${field}: ${JSON.stringify(candidate)}`);
    }
    if (candidate.action === "update" && !candidate.matched_existing_id) {
      throw new Error(`${basename(path)} update is missing matched_existing_id: ${candidate.title}`);
    }
    if (!Array.isArray(candidate.source_urls) || candidate.source_urls.length === 0) {
      throw new Error(`${basename(path)} candidate is missing source URLs: ${candidate.title}`);
    }
  }

  reviews.push({ year, path, review, articles, candidates });
  await writeFile(resolve(REPORT_ROOT, `fripside-official-news-${year}-review.json`), `${JSON.stringify(review, null, 2)}\n`);
}

const notionEvents = JSON.parse(await readFile(resolve(NORMALIZED_ROOT, "events.json"), "utf8"));
const official2026Events = JSON.parse(await readFile(resolve(NORMALIZED_ROOT, "fripside-official-news-2026.json"), "utf8"));
const existingById = new Map();

for (const event of notionEvents) existingById.set(event.id, normalizedExisting(event));
for (const event of official2026Events) existingById.set(event.id, normalizedExisting(event));

const groupedCandidates = new Map();
for (const { year, candidates } of reviews) {
  for (const rawCandidate of candidates) {
    const candidate = {
      ...rawCandidate,
      _review_year: year,
      _review_years: [year],
      source_urls: unique(rawCandidate.source_urls)
    };
    const key = candidate.action === "update"
      ? `id:${candidate.matched_existing_id}`
      : `new:${candidate.start_date}|${candidate.start_time ?? ""}|${normalizeTitle(candidate.title)}`;
    groupedCandidates.set(key, mergeCandidates(groupedCandidates.get(key), candidate));
  }
}

const normalizedEvents = [];
for (const [key, candidate] of groupedCandidates) {
  const action = candidate.action;
  let event;

  if (action === "update") {
    const existing = existingById.get(candidate.matched_existing_id);
    if (!existing) throw new Error(`Unknown matched_existing_id: ${candidate.matched_existing_id}`);
    event = {
      ...existing,
      id: existing.id,
      slug: existing.slug,
      title: existing.title,
      start_date: candidate.start_date,
      end_date: isPresent(candidate.end_date) ? candidate.end_date : existing.end_date,
      start_time: isPresent(candidate.start_time) ? candidate.start_time : existing.start_time,
      end_time: isPresent(candidate.end_time) ? candidate.end_time : existing.end_time,
      timezone: candidate.timezone ?? existing.timezone,
      category: candidate.category ?? existing.category,
      classification: isPresent(candidate.classification) ? candidate.classification : existing.classification,
      venue: isPresent(candidate.venue) ? candidate.venue : existing.venue,
      region: isPresent(candidate.region) ? candidate.region : existing.region,
      remark: mergeRemark(existing.remark, candidate.remark),
      status: candidate.status,
      published: true
    };
  } else if (action === "create") {
    const idSeed = `${candidate.start_date}|${candidate.start_time ?? ""}|${candidate.title}`;
    event = {
      id: `evt_official_${hash(idSeed)}`,
      slug: "",
      title: candidate.title,
      start_date: candidate.start_date,
      end_date: candidate.end_date ?? null,
      start_time: candidate.start_time ?? null,
      end_time: candidate.end_time ?? null,
      timezone: candidate.timezone ?? "Asia/Tokyo",
      category: candidate.category,
      classification: candidate.classification ?? null,
      venue: candidate.venue ?? null,
      region: candidate.region ?? null,
      remark: candidate.remark ?? null,
      status: candidate.status,
      published: true,
      sources: []
    };
    event.slug = makeSlug(event);
  } else {
    throw new Error(`Unsupported action ${action} for ${key}`);
  }

  event.action = action;
  event.confidence = candidate.confidence ?? null;
  event.review_years = candidate._review_years ?? [candidate._review_year];
  event.sources = unique([
    ...(event.sources ?? []).map((source) => source.url),
    ...candidate.source_urls
  ]).map((url) => ({
    url,
    label: url.startsWith("https://fripside.net/contents/") ? "fripSide official news" : new URL(url).hostname,
    source_type: "official"
  }));
  normalizedEvents.push(event);
}

normalizedEvents.sort((a, b) => (
  a.start_date.localeCompare(b.start_date)
  || (a.start_time ?? "").localeCompare(b.start_time ?? "")
  || a.title.localeCompare(b.title, "ja")
));

const normalizedIds = new Set();
const normalizedSlugs = new Set(notionEvents.map((event) => event.slug));
for (const event of normalizedEvents) {
  if (normalizedIds.has(event.id)) throw new Error(`Duplicate normalized event id: ${event.id}`);
  normalizedIds.add(event.id);
  if (event.action === "create" && normalizedSlugs.has(event.slug)) throw new Error(`Duplicate event slug: ${event.slug}`);
  normalizedSlugs.add(event.slug);
}

const potentialDuplicates = [];
for (const event of normalizedEvents.filter((item) => item.action === "create")) {
  const sameDate = notionEvents.filter((existing) => existing.start_date === event.start_date);
  for (const existing of sameDate) {
    const left = normalizeTitle(existing.title);
    const right = normalizeTitle(event.title);
    if (left === right || (left.length >= 10 && right.length >= 10 && (left.includes(right) || right.includes(left)))) {
      potentialDuplicates.push({ created_event: event, existing_event: existing });
    }
  }
}

if (potentialDuplicates.length > 0) {
  throw new Error(`Potential duplicate create candidates must be resolved: ${JSON.stringify(potentialDuplicates, null, 2)}`);
}

const publicEvents = normalizedEvents.map(({ confidence, review_years, action, ...event }) => ({
  ...event,
  action,
  confidence,
  review_years
}));
const normalizedPath = resolve(NORMALIZED_ROOT, "fripside-official-news-2022-2025.json");
await writeFile(normalizedPath, `${JSON.stringify(publicEvents, null, 2)}\n`);

const sql = ["PRAGMA foreign_keys = ON;", ""];
for (const event of publicEvents) {
  sql.push(
    "INSERT INTO events (",
    "  id, slug, title, start_date, end_date, start_time, end_time, timezone, category,",
    "  classification, venue, region, remark, status, published, version, created_at, updated_at, published_at, archived_at",
    `) VALUES (${[
      event.id,
      event.slug,
      event.title,
      event.start_date,
      event.end_date,
      event.start_time,
      event.end_time,
      event.timezone,
      event.category,
      event.classification,
      event.venue,
      event.region,
      event.remark,
      event.status,
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

  for (const source of event.sources) {
    const sourceId = `src_official_${hash(`${event.id}|${source.url}`)}`;
    sql.push(
      "INSERT OR IGNORE INTO event_sources (id, event_id, url, label, source_type, verified_at, created_at, created_by)",
      `VALUES (${[
        sourceId,
        event.id,
        source.url,
        source.label,
        source.source_type,
        VERIFIED_AT,
        VERIFIED_AT,
        "official-news-2022-2025-import"
      ].map(sqlValue).join(", ")});`,
      ""
    );
  }

  const auditId = `aud_official_${hash(`2022-2025|${event.id}`)}`;
  const auditPayload = JSON.stringify(event);
  const metadata = JSON.stringify({
    source: "fripside.net/contents/news",
    review_years: event.review_years,
    source_urls: event.sources.map((source) => source.url)
  });
  sql.push(
    "INSERT OR IGNORE INTO audit_logs (id, actor_id, actor_type, channel, action, target_type, target_id, request_id, before_json, after_json, metadata_json, created_at)",
    `VALUES (${[
      auditId,
      "official-news-2022-2025-import",
      "system",
      "import",
      `event.${event.action}`,
      "event",
      event.id,
      `req_${hash(auditId)}`,
      null,
      auditPayload,
      metadata,
      VERIFIED_AT
    ].map(sqlValue).join(", ")});`,
    ""
  );
}

const summary = {
  source: "https://fripside.net/contents/news/",
  publication_years: YEARS,
  generated_at: VERIFIED_AT,
  reviewed_articles: reviews.reduce((sum, item) => sum + item.articles.length, 0),
  reviewed_articles_by_year: Object.fromEntries(reviews.map(({ year, articles }) => [year, articles.length])),
  candidates_before_cross_year_merge: reviews.reduce((sum, item) => sum + item.candidates.length, 0),
  normalized_events: publicEvents.length,
  actions: {
    update: publicEvents.filter((event) => event.action === "update").length,
    create: publicEvents.filter((event) => event.action === "create").length
  },
  event_years: Object.fromEntries([...new Set(publicEvents.map((event) => event.start_date.slice(0, 4)))].sort().map((year) => [
    year,
    publicEvents.filter((event) => event.start_date.startsWith(year)).length
  ])),
  official_sources: publicEvents.reduce((sum, event) => sum + event.sources.length, 0),
  potential_duplicates: potentialDuplicates,
  input_reviews: reviews.map(({ year, path, articles, candidates }) => ({
    year,
    file: basename(path),
    reviewed_articles: articles.length,
    candidates: candidates.length
  }))
};

const importJobId = `imp_official_${hash(JSON.stringify(summary))}`;
sql.push(
  "INSERT OR IGNORE INTO import_jobs (id, filename, status, total_rows, valid_rows, invalid_rows, report_json, created_by, created_at, imported_at)",
  `VALUES (${[
    importJobId,
    "fripside-official-news-2022-2025.json",
    "imported",
    publicEvents.length,
    publicEvents.length,
    0,
    JSON.stringify(summary),
    "official-news-2022-2025-import",
    VERIFIED_AT,
    VERIFIED_AT
  ].map(sqlValue).join(", ")});`,
  ""
);

const sqlPath = resolve(NORMALIZED_ROOT, "fripside-official-news-2022-2025.sql");
const summaryPath = resolve(REPORT_ROOT, "fripside-official-news-2022-2025-summary.json");
await writeFile(sqlPath, `${sql.join("\n")}\n`);
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(JSON.stringify({ normalizedPath, sqlPath, summaryPath, summary }, null, 2));
