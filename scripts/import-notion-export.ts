import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createEventSlug, dateInTimeZone, type Category, type EventStatus } from "@frip-fan/core";

interface NormalizedLegacyEvent {
  legacy_key: string;
  id: string;
  slug: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  timezone: "Asia/Tokyo";
  category: Category;
  classification: string | null;
  venue: string | null;
  region: string | null;
  remark: string | null;
  status: EventStatus;
  published: true;
  source_url: string | null;
  source_label: string | null;
  import_warnings: string[];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((item) => item.some((cell) => cell.trim()));
}

function stableId(value: string, prefix: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function toIsoDate(value: string): string | null {
  const trimmed = value.trim();
  const iso = trimmed.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

function parseDateRange(value: string): { start: string | null; end: string | null } {
  const isoMatches = value.match(/\d{4}-\d{2}-\d{2}/g);
  if (isoMatches?.length) return { start: isoMatches[0], end: isoMatches[1] ?? null };
  const parts = value.split(/\s*(?:→|->|—|\bto\b)\s*/i).filter(Boolean);
  return { start: toIsoDate(parts[0] ?? ""), end: parts[1] ? toIsoDate(parts[1]) : null };
}

function mapCategory(tags: string, classification: string): Category {
  const value = `${tags} ${classification}`.toLowerCase();
  if (/live|tour|concert|ライブ/.test(value)) return "LIVE";
  if (/release|single|album|blu.?ray|dvd|cd|発売/.test(value)) return "RELEASE";
  if (/media|radio|tv|stream|broadcast|ラジオ|テレビ/.test(value)) return "MEDIA";
  if (/event|fes|festival|イベント/.test(value)) return "EVENT";
  return "OTHER";
}

function mapStatus(title: string, date: string): EventStatus {
  if (/中止|cancel(?:led|ed|lation)/i.test(title)) return "cancelled";
  if (/延期|postpone/i.test(title)) return "postponed";
  return date < dateInTimeZone() ? "completed" : "scheduled";
}

function findSource(values: string[]): string | null {
  for (const value of values) {
    const found = value.match(/https:\/\/[^\s<>()\]"']+/i)?.[0]?.replace(/[.,;:]+$/, "");
    if (found) return found;
  }
  return null;
}

function valueOf(row: string[], headers: string[], ...names: string[]): string {
  for (const name of names) {
    const index = headers.findIndex((header) => header.trim().toLowerCase() === name.toLowerCase());
    if (index >= 0) return row[index]?.trim() ?? "";
  }
  return "";
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("用法：npm run import:notion -- data/raw/export.csv");
  process.exit(1);
}

const csv = await readFile(resolve(inputPath), "utf8");
const [headerRow, ...dataRows] = parseCsv(csv.replace(/^\uFEFF/, ""));
if (!headerRow) throw new Error("CSV 为空");

const normalized: NormalizedLegacyEvent[] = [];
const excluded: Array<{ row: number; title: string; reasons: string[] }> = [];
const seenSlugs = new Set<string>();

dataRows.forEach((row, index) => {
  const rowNumber = index + 2;
  const title = valueOf(row, headerRow, "Name", "Title", "名称");
  const rawDate = valueOf(row, headerRow, "Date", "日期");
  const tags = valueOf(row, headerRow, "Tags", "Tag", "标签");
  const classification = valueOf(row, headerRow, "Classification", "分类");
  const remark = valueOf(row, headerRow, "Remark", "备注");
  const text = valueOf(row, headerRow, "Text", "URL", "Link", "链接");
  const reasons: string[] = [];
  const dates = parseDateRange(rawDate);
  if (!title) reasons.push("标题为空");
  if (!dates.start) reasons.push(`无法解析日期：${rawDate || "空"}`);
  if (/^\d{4}$/.test(title) && !tags && !classification) reasons.push("疑似 Gallery 年份分隔记录");
  if (reasons.length || !dates.start) {
    excluded.push({ row: rowNumber, title, reasons });
    return;
  }
  const legacyKey = `${title}|${dates.start}|${dates.end ?? ""}`;
  const id = stableId(legacyKey, "evt_legacy");
  let slug = createEventSlug(dates.start, title, id);
  if (seenSlugs.has(slug)) slug = `${slug}-${id.slice(-6)}`;
  seenSlugs.add(slug);
  const source = findSource([text, remark, ...row]);
  const warnings: string[] = [];
  if (!source) warnings.push("没有识别到来源 URL，按 legacy-import 导入，后续应补充");
  normalized.push({
    legacy_key: legacyKey,
    id,
    slug,
    title,
    start_date: dates.start,
    end_date: dates.end,
    start_time: null,
    end_time: null,
    timezone: "Asia/Tokyo",
    category: mapCategory(tags, classification),
    classification: classification || null,
    venue: null,
    region: null,
    remark: remark || null,
    status: mapStatus(title, dates.start),
    published: true,
    source_url: source,
    source_label: source ? "Legacy source" : null,
    import_warnings: warnings
  });
});

const categoryCounts = normalized.reduce<Record<string, number>>((counts, event) => {
  counts[event.category] = (counts[event.category] ?? 0) + 1;
  return counts;
}, {});
const report = {
  source_file: basename(inputPath),
  generated_at: new Date().toISOString(),
  source_rows: dataRows.length,
  normalized_rows: normalized.length,
  excluded_rows: excluded.length,
  missing_source_rows: normalized.filter((event) => !event.source_url).length,
  min_date: normalized.map((event) => event.start_date).sort()[0] ?? null,
  max_date: normalized.map((event) => event.end_date ?? event.start_date).sort().at(-1) ?? null,
  category_counts: categoryCounts,
  excluded
};

await mkdir(resolve("data/normalized"), { recursive: true });
await mkdir(resolve("data/reports"), { recursive: true });
await writeFile(resolve("data/normalized/events.json"), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
await writeFile(resolve("data/reports/notion-import.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`读取 ${dataRows.length} 行；规范化 ${normalized.length} 行；排除 ${excluded.length} 行；缺少来源 ${report.missing_source_rows} 行。`);
console.log("输出：data/normalized/events.json");
console.log("报告：data/reports/notion-import.json");
