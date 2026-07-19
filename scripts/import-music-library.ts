import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { ReleaseType, SetlistCompleteness, SetlistConfidence, SetlistSection, VersionRelationType } from "@frip-fan/core";
import { normalizeForDuplicate } from "@frip-fan/core";

interface SongInput {
  slug: string;
  title: string;
  originalArtist: string;
  firstReleaseDate: string | null;
  notes: string | null;
}

interface VersionInput {
  slug: string;
  songSlug: string;
  title: string;
  versionLabel: string | null;
  artistCredit: string;
  releaseDate: string | null;
  notes: string | null;
  parentSlug: string | null;
  relationType: VersionRelationType | null;
}

interface ReleaseInput {
  slug: string;
  title: string;
  type: ReleaseType;
  releaseDate: string | null;
  catalogNumber: string | null;
  edition: string | null;
  notes: string | null;
  sourceUrl: string | null;
}

interface TrackInput {
  releaseSlug: string;
  versionSlug: string;
  discNumber: number;
  trackNumber: number;
  displayTitle: string;
  notes: string | null;
}

interface SetlistInput {
  eventSlug: string;
  performanceLabel: string;
  title: string | null;
  completeness: SetlistCompleteness;
  confidence: SetlistConfidence;
  notes: string | null;
  sourceUrl: string | null;
}

interface SetlistEntryInput {
  setlistKey: string;
  position: number;
  section: SetlistSection;
  songSlug: string;
  versionSlug: string | null;
  displayTitle: string;
  medleyGroup: string | null;
  notes: string | null;
}

interface RejectedRow {
  file: string;
  row: number;
  reasons: string[];
}

const releaseTypes = new Set<ReleaseType>(["album", "single", "ep", "compilation", "video", "other"]);
const completenessValues = new Set<SetlistCompleteness>(["complete", "partial", "unknown"]);
const confidenceValues = new Set<SetlistConfidence>(["official", "reported", "unverified"]);
const sectionValues = new Set<SetlistSection>(["main", "encore", "double_encore", "opening", "other"]);
const relationTypes = new Set<VersionRelationType>([
  "re-recording_of", "rearrangement_of", "remix_of", "cover_of", "live_version_of", "instrumental_of", "edit_of", "other",
]);

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

function sql(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

function nullable(value: string | undefined): string | null {
  return clean(value) || null;
}

function validSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function validDate(value: string | null): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validUrl(value: string | null): boolean {
  if (!value) return true;
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}

function positiveInt(value: string, fallback?: number): number | null {
  if (!value && fallback !== undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function rowObject(headers: string[], row: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header.trim().toLowerCase(), clean(row[index])]));
}

function collectAliases(aliases: Map<string, Set<string>>, songSlug: string, value: string): void {
  if (!value) return;
  const bucket = aliases.get(songSlug) ?? new Set<string>();
  for (const alias of value.split(/[|;]/).map((item) => item.trim()).filter(Boolean)) bucket.add(alias);
  aliases.set(songSlug, bucket);
}

function mergeUnique<T>(map: Map<string, T>, key: string, input: T, fields: Array<keyof T>, label: string, reasons: string[]): void {
  const existing = map.get(key);
  if (!existing) { map.set(key, input); return; }
  for (const field of fields) {
    const left = existing[field];
    const right = input[field];
    if (left != null && right != null && left !== right) reasons.push(`${label} ${key} 的 ${String(field)} 前后不一致`);
    else if (left == null && right != null) Object.assign(existing as object, { [field]: right });
  }
}

const releaseCsvPath = process.argv[2];
const setlistCsvPath = process.argv[3];
const outputSqlPath = resolve(process.argv[4] || "data/normalized/music-library-import.sql");

if (!releaseCsvPath || !setlistCsvPath) {
  console.error("用法：npm run import:music -- <release-tracks.csv> <setlists.csv> [output.sql]");
  process.exit(1);
}

const songs = new Map<string, SongInput>();
const aliases = new Map<string, Set<string>>();
const versions = new Map<string, VersionInput>();
const releases = new Map<string, ReleaseInput>();
const tracks: TrackInput[] = [];
const setlists = new Map<string, SetlistInput>();
const entries: SetlistEntryInput[] = [];
const rejected: RejectedRow[] = [];
const seenTracks = new Set<string>();
const seenEntries = new Set<string>();

const releaseText = await readFile(resolve(releaseCsvPath), "utf8");
const [releaseHeaders, ...releaseRows] = parseCsv(releaseText.replace(/^\uFEFF/, ""));
if (!releaseHeaders) throw new Error("发行曲目 CSV 为空");

for (const [index, row] of releaseRows.entries()) {
  const data = rowObject(releaseHeaders, row);
  const rowNumber = index + 2;
  const reasons: string[] = [];
  const releaseSlug = data.release_slug;
  const releaseTitle = data.release_title;
  const releaseType = (data.release_type || "other") as ReleaseType;
  const releaseDate = nullable(data.release_date);
  const songSlug = data.song_slug;
  const songTitle = data.song_title;
  const songFirstReleaseDate = nullable(data.song_first_release_date);
  const versionSlug = data.version_slug || (songSlug ? `${songSlug}-original` : "");
  const versionTitle = data.version_title || songTitle;
  const versionReleaseDate = nullable(data.version_release_date) || releaseDate;
  const parentSlug = nullable(data.parent_version_slug);
  const parentReleaseDate = nullable(data.parent_release_date);
  const relationType = nullable(data.relation_type) as VersionRelationType | null;
  const discNumber = positiveInt(data.disc_number, 1);
  const trackNumber = positiveInt(data.track_number);
  const sourceUrl = nullable(data.source_url);

  if (!validSlug(releaseSlug)) reasons.push("release_slug 必须是小写字母、数字和连字符");
  if (!releaseTitle) reasons.push("release_title 为空");
  if (!releaseTypes.has(releaseType)) reasons.push(`未知 release_type：${releaseType}`);
  if (!validDate(releaseDate)) reasons.push(`release_date 不是 YYYY-MM-DD：${releaseDate}`);
  if (!validSlug(songSlug)) reasons.push("song_slug 必须是小写字母、数字和连字符");
  if (!songTitle) reasons.push("song_title 为空");
  if (!validDate(songFirstReleaseDate)) reasons.push(`song_first_release_date 不是 YYYY-MM-DD：${songFirstReleaseDate}`);
  if (!validSlug(versionSlug)) reasons.push("version_slug 必须是小写字母、数字和连字符");
  if (!versionTitle) reasons.push("version_title 为空");
  if (!validDate(versionReleaseDate)) reasons.push(`version_release_date 不是 YYYY-MM-DD：${versionReleaseDate}`);
  if (parentSlug && !validSlug(parentSlug)) reasons.push("parent_version_slug 格式错误");
  if (parentSlug === versionSlug) reasons.push("父版本不能指向自身");
  if (!validDate(parentReleaseDate)) reasons.push(`parent_release_date 不是 YYYY-MM-DD：${parentReleaseDate}`);
  if ((parentSlug && !relationType) || (!parentSlug && relationType)) reasons.push("parent_version_slug 与 relation_type 必须同时填写");
  if (relationType && !relationTypes.has(relationType)) reasons.push(`未知 relation_type：${relationType}`);
  if (discNumber == null) reasons.push("disc_number 必须为正整数");
  if (trackNumber == null) reasons.push("track_number 必须为正整数");
  if (!validUrl(sourceUrl)) reasons.push("source_url 不是有效的 HTTP(S) URL");
  const trackKey = `${releaseSlug}|${discNumber}|${trackNumber}`;
  if (seenTracks.has(trackKey)) reasons.push(`重复的发行曲目位置：${trackKey}`);

  if (reasons.length || discNumber == null || trackNumber == null) {
    rejected.push({ file: basename(releaseCsvPath), row: rowNumber, reasons });
    continue;
  }

  mergeUnique(songs, songSlug, {
    slug: songSlug,
    title: songTitle,
    originalArtist: data.original_artist || "fripSide",
    firstReleaseDate: songFirstReleaseDate,
    notes: nullable(data.song_notes),
  }, ["title", "originalArtist", "firstReleaseDate", "notes"], "歌曲", reasons);
  collectAliases(aliases, songSlug, data.song_aliases);
  mergeUnique(versions, versionSlug, {
    slug: versionSlug,
    songSlug,
    title: versionTitle,
    versionLabel: nullable(data.version_label),
    artistCredit: data.artist_credit || "fripSide",
    releaseDate: versionReleaseDate,
    notes: nullable(data.version_notes),
    parentSlug,
    relationType,
  }, ["songSlug", "title", "versionLabel", "artistCredit", "releaseDate", "notes", "parentSlug", "relationType"], "版本", reasons);
  if (parentSlug) {
    mergeUnique(versions, parentSlug, {
      slug: parentSlug,
      songSlug,
      title: data.parent_version_title || songTitle,
      versionLabel: nullable(data.parent_version_label) || "original",
      artistCredit: data.parent_artist_credit || data.original_artist || "fripSide",
      releaseDate: parentReleaseDate,
      notes: null,
      parentSlug: null,
      relationType: null,
    }, ["songSlug", "title", "versionLabel", "artistCredit", "releaseDate"], "父版本", reasons);
  }
  mergeUnique(releases, releaseSlug, {
    slug: releaseSlug,
    title: releaseTitle,
    type: releaseType,
    releaseDate,
    catalogNumber: nullable(data.catalog_number),
    edition: nullable(data.edition),
    notes: nullable(data.release_notes),
    sourceUrl,
  }, ["title", "type", "releaseDate", "catalogNumber", "edition"], "发行物", reasons);

  if (reasons.length) {
    rejected.push({ file: basename(releaseCsvPath), row: rowNumber, reasons });
    continue;
  }
  seenTracks.add(trackKey);
  tracks.push({ releaseSlug, versionSlug, discNumber, trackNumber, displayTitle: data.display_title || versionTitle, notes: nullable(data.track_notes) });
}

const setlistText = await readFile(resolve(setlistCsvPath), "utf8");
const [setlistHeaders, ...setlistRows] = parseCsv(setlistText.replace(/^\uFEFF/, ""));
if (!setlistHeaders) throw new Error("Live 歌单 CSV 为空");

for (const [index, row] of setlistRows.entries()) {
  const data = rowObject(setlistHeaders, row);
  const rowNumber = index + 2;
  const reasons: string[] = [];
  const eventSlug = data.event_slug;
  const performanceLabel = data.performance_label || "本公演";
  const setlistKey = `${eventSlug}|${performanceLabel}`;
  const songSlug = data.song_slug;
  const songTitle = data.song_title || data.display_title;
  const songFirstReleaseDate = nullable(data.song_first_release_date);
  const versionSlug = nullable(data.version_slug);
  const position = positiveInt(data.position);
  const section = (data.section || "main") as SetlistSection;
  const completeness = (data.completeness || "unknown") as SetlistCompleteness;
  const confidence = (data.confidence || "unverified") as SetlistConfidence;
  const sourceUrl = nullable(data.source_url);

  if (!validSlug(eventSlug)) reasons.push("event_slug 格式错误");
  if (!performanceLabel) reasons.push("performance_label 为空");
  if (!validSlug(songSlug)) reasons.push("song_slug 格式错误");
  if (!songTitle) reasons.push("song_title 为空");
  if (!validDate(songFirstReleaseDate)) reasons.push(`song_first_release_date 不是 YYYY-MM-DD：${songFirstReleaseDate}`);
  if (position == null) reasons.push("position 必须为正整数");
  if (!sectionValues.has(section)) reasons.push(`未知 section：${section}`);
  if (!completenessValues.has(completeness)) reasons.push(`未知 completeness：${completeness}`);
  if (!confidenceValues.has(confidence)) reasons.push(`未知 confidence：${confidence}`);
  if (versionSlug && !validSlug(versionSlug)) reasons.push("version_slug 格式错误");
  if (!validUrl(sourceUrl)) reasons.push("source_url 不是有效的 HTTP(S) URL");
  const entryKey = `${setlistKey}|${position}`;
  if (seenEntries.has(entryKey)) reasons.push(`重复的歌单位置：${entryKey}`);

  if (reasons.length || position == null) {
    rejected.push({ file: basename(setlistCsvPath), row: rowNumber, reasons });
    continue;
  }

  mergeUnique(songs, songSlug, {
    slug: songSlug,
    title: songTitle,
    originalArtist: data.original_artist || "fripSide",
    firstReleaseDate: songFirstReleaseDate,
    notes: nullable(data.song_notes),
  }, ["title", "originalArtist", "firstReleaseDate", "notes"], "歌曲", reasons);
  collectAliases(aliases, songSlug, data.song_aliases);

  if (versionSlug && !versions.has(versionSlug)) {
    versions.set(versionSlug, {
      slug: versionSlug,
      songSlug,
      title: data.version_title || songTitle,
      versionLabel: nullable(data.version_label),
      artistCredit: data.artist_credit || "fripSide",
      releaseDate: null,
      notes: null,
      parentSlug: null,
      relationType: null,
    });
  } else if (versionSlug && versions.get(versionSlug)?.songSlug !== songSlug) {
    reasons.push(`版本 ${versionSlug} 已关联到另一首歌曲`);
  }

  mergeUnique(setlists, setlistKey, {
    eventSlug,
    performanceLabel,
    title: nullable(data.setlist_title),
    completeness,
    confidence,
    notes: nullable(data.setlist_notes),
    sourceUrl,
  }, ["title", "completeness", "confidence", "sourceUrl"], "歌单", reasons);

  if (reasons.length) {
    rejected.push({ file: basename(setlistCsvPath), row: rowNumber, reasons });
    continue;
  }
  seenEntries.add(entryKey);
  entries.push({
    setlistKey,
    position,
    section,
    songSlug,
    versionSlug,
    displayTitle: data.display_title || songTitle,
    medleyGroup: nullable(data.medley_group),
    notes: nullable(data.entry_notes),
  });
}

if (rejected.length) {
  await mkdir(resolve("data/reports"), { recursive: true });
  const failedReport = {
    generated_at: new Date().toISOString(),
    status: "rejected",
    release_rows: releaseRows.length,
    setlist_rows: setlistRows.length,
    rejected_rows: rejected,
  };
  await writeFile(resolve("data/reports/music-library-import.json"), `${JSON.stringify(failedReport, null, 2)}\n`, "utf8");
  console.error(`发现 ${rejected.length} 条数据问题，未生成 SQL。详见 data/reports/music-library-import.json`);
  process.exit(1);
}

const now = new Date().toISOString();
const statements: string[] = ["PRAGMA foreign_keys = ON;", "BEGIN TRANSACTION;"];

for (const song of songs.values()) {
  const id = stableId(song.slug, "mus_song");
  statements.push(`INSERT INTO songs (id, slug, title, normalized_title, original_artist, first_release_date, notes, published, created_at, updated_at)
VALUES (${[id, song.slug, song.title, normalizeForDuplicate(song.title), song.originalArtist, song.firstReleaseDate, song.notes, 1, now, now].map(sql).join(", ")})
ON CONFLICT(slug) DO UPDATE SET title = excluded.title, normalized_title = excluded.normalized_title,
  original_artist = excluded.original_artist, first_release_date = COALESCE(songs.first_release_date, excluded.first_release_date),
  notes = COALESCE(excluded.notes, songs.notes), updated_at = excluded.updated_at;`);
  for (const alias of aliases.get(song.slug) ?? []) {
    statements.push(`INSERT OR IGNORE INTO song_aliases (id, song_id, alias, normalized_alias, created_at)
VALUES (${sql(stableId(`${song.slug}|${normalizeForDuplicate(alias)}`, "mus_alias"))},
  (SELECT id FROM songs WHERE slug = ${sql(song.slug)}), ${[alias, normalizeForDuplicate(alias), now].map(sql).join(", ")});`);
  }
}

for (const version of versions.values()) {
  const id = stableId(version.slug, "mus_ver");
  statements.push(`INSERT INTO song_versions (id, song_id, slug, title, version_label, artist_credit, release_date, notes, published, created_at, updated_at)
VALUES (${sql(id)}, (SELECT id FROM songs WHERE slug = ${sql(version.songSlug)}), ${[version.slug, version.title, version.versionLabel, version.artistCredit, version.releaseDate, version.notes, 1, now, now].map(sql).join(", ")})
ON CONFLICT(slug) DO UPDATE SET song_id = excluded.song_id, title = excluded.title, version_label = excluded.version_label,
  artist_credit = excluded.artist_credit, release_date = COALESCE(song_versions.release_date, excluded.release_date),
  notes = COALESCE(excluded.notes, song_versions.notes), updated_at = excluded.updated_at;`);
}

for (const version of versions.values()) {
  if (!version.parentSlug || !version.relationType) continue;
  const relationId = stableId(`${version.slug}|${version.parentSlug}|${version.relationType}`, "mus_vrel");
  statements.push(`INSERT OR IGNORE INTO song_version_relations (id, child_version_id, parent_version_id, relation_type, notes, created_at)
VALUES (${sql(relationId)}, (SELECT id FROM song_versions WHERE slug = ${sql(version.slug)}),
  (SELECT id FROM song_versions WHERE slug = ${sql(version.parentSlug)}), ${[version.relationType, version.notes, now].map(sql).join(", ")});`);
}

for (const release of releases.values()) {
  const id = stableId(release.slug, "mus_rel");
  statements.push(`INSERT INTO releases (id, slug, title, release_type, release_date, catalog_number, edition, notes, published, created_at, updated_at)
VALUES (${[id, release.slug, release.title, release.type, release.releaseDate, release.catalogNumber, release.edition, release.notes, 1, now, now].map(sql).join(", ")})
ON CONFLICT(slug) DO UPDATE SET title = excluded.title, release_type = excluded.release_type, release_date = excluded.release_date,
  catalog_number = excluded.catalog_number, edition = excluded.edition, notes = COALESCE(excluded.notes, releases.notes), updated_at = excluded.updated_at;`);
  if (release.sourceUrl) {
    statements.push(`INSERT OR IGNORE INTO catalog_sources (id, subject_type, subject_id, url, label, source_type, verified_at, created_at, created_by)
VALUES (${[stableId(`release|${release.slug}|${release.sourceUrl}`, "mus_src"), "release"].map(sql).join(", ")},
  (SELECT id FROM releases WHERE slug = ${sql(release.slug)}),
  ${[release.sourceUrl, "发行信息来源", "release-import", now, now, "music-import"].map(sql).join(", ")});`);
  }
}

for (const track of tracks) {
  const id = stableId(`${track.releaseSlug}|${track.discNumber}|${track.trackNumber}`, "mus_track");
  statements.push(`INSERT INTO release_tracks (id, release_id, song_version_id, disc_number, track_number, display_title, notes, created_at)
VALUES (${sql(id)}, (SELECT id FROM releases WHERE slug = ${sql(track.releaseSlug)}),
  (SELECT id FROM song_versions WHERE slug = ${sql(track.versionSlug)}),
  ${[track.discNumber, track.trackNumber, track.displayTitle, track.notes, now].map(sql).join(", ")})
ON CONFLICT(release_id, disc_number, track_number) DO UPDATE SET song_version_id = excluded.song_version_id,
  display_title = excluded.display_title, notes = excluded.notes;`);
}

for (const [key, setlist] of setlists) {
  const id = stableId(key, "mus_set");
  statements.push(`INSERT INTO setlists (id, event_id, performance_label, title, completeness, confidence, notes, published, created_at, updated_at)
VALUES (${sql(id)}, (SELECT id FROM events WHERE slug = ${sql(setlist.eventSlug)}),
  ${[setlist.performanceLabel, setlist.title, setlist.completeness, setlist.confidence, setlist.notes, 1, now, now].map(sql).join(", ")})
ON CONFLICT(event_id, performance_label) DO UPDATE SET title = excluded.title, completeness = excluded.completeness,
  confidence = excluded.confidence, notes = COALESCE(excluded.notes, setlists.notes), updated_at = excluded.updated_at;`);
  if (setlist.sourceUrl) {
    statements.push(`INSERT OR IGNORE INTO catalog_sources (id, subject_type, subject_id, url, label, source_type, verified_at, created_at, created_by)
VALUES (${[stableId(`setlist|${key}|${setlist.sourceUrl}`, "mus_src"), "setlist"].map(sql).join(", ")},
  (SELECT sl.id FROM setlists sl JOIN events e ON e.id = sl.event_id
    WHERE e.slug = ${sql(setlist.eventSlug)} AND sl.performance_label = ${sql(setlist.performanceLabel)}),
  ${[
      setlist.sourceUrl, "歌单来源", "setlist-import", setlist.confidence === "official" ? now : null, now, "music-import",
    ].map(sql).join(", ")});`);
  }
}

for (const entry of entries) {
  const setlist = setlists.get(entry.setlistKey)!;
  const id = stableId(`${entry.setlistKey}|${entry.position}`, "mus_entry");
  statements.push(`INSERT INTO setlist_entries (id, setlist_id, position, section, song_id, performed_version_id, display_title, medley_group, notes, created_at)
VALUES (${sql(id)},
  (SELECT sl.id FROM setlists sl JOIN events e ON e.id = sl.event_id
    WHERE e.slug = ${sql(setlist.eventSlug)} AND sl.performance_label = ${sql(setlist.performanceLabel)}),
  ${[entry.position, entry.section].map(sql).join(", ")},
  (SELECT id FROM songs WHERE slug = ${sql(entry.songSlug)}),
  ${entry.versionSlug ? `(SELECT id FROM song_versions WHERE slug = ${sql(entry.versionSlug)})` : "NULL"},
  ${[entry.displayTitle, entry.medleyGroup, entry.notes, now].map(sql).join(", ")})
ON CONFLICT(setlist_id, position) DO UPDATE SET section = excluded.section, song_id = excluded.song_id,
  performed_version_id = excluded.performed_version_id, display_title = excluded.display_title,
  medley_group = excluded.medley_group, notes = excluded.notes;`);
}

const report = {
  generated_at: now,
  status: "ready",
  source_files: [basename(releaseCsvPath), basename(setlistCsvPath)],
  release_rows: releaseRows.length,
  setlist_rows: setlistRows.length,
  songs: songs.size,
  versions: versions.size,
  releases: releases.size,
  tracks: tracks.length,
  setlists: setlists.size,
  setlist_entries: entries.length,
  note: "event_slug 必须已存在于 events；否则 SQL 会因外键前置校验失败并回滚。",
};

statements.push(`INSERT OR IGNORE INTO import_jobs (id, filename, status, total_rows, valid_rows, invalid_rows, report_json, created_by, created_at, imported_at)
VALUES (${[
  stableId(`${basename(releaseCsvPath)}|${basename(setlistCsvPath)}|${tracks.length}|${entries.length}`, "imp_music"),
  `${basename(releaseCsvPath)} + ${basename(setlistCsvPath)}`, "imported", releaseRows.length + setlistRows.length,
  tracks.length + entries.length, 0, JSON.stringify(report), "music-import", now, now,
].map(sql).join(", ")});`);
statements.push("COMMIT;");

await mkdir(resolve("data/normalized"), { recursive: true });
await mkdir(resolve("data/reports"), { recursive: true });
await writeFile(outputSqlPath, `${statements.join("\n\n")}\n`, "utf8");
await writeFile(resolve("data/reports/music-library-import.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`已生成 ${outputSqlPath}`);
console.log(`歌曲 ${songs.size}；版本 ${versions.size}；发行物 ${releases.size}；曲目 ${tracks.length}；Live 歌单 ${setlists.size}；演唱记录 ${entries.length}。`);
console.log("先执行 npm run db:migrate:local，再用 wrangler d1 execute --local --file 导入生成的 SQL。");
