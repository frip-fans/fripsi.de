import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const researchPath = resolve("data/research/livefans-fripside-setlists.json");
const eventsPath = resolve("data/normalized/events.json");
const discographyPath = resolve("data/normalized/fripside-complete-discography-tracks.csv");
const outputCsv = resolve("data/normalized/fripside-phase3-livefans-setlists.csv");
const emptyReleasesCsv = resolve("data/normalized/fripside-phase3-livefans-empty-release-tracks.csv");
const outputReport = resolve("data/reports/fripside-phase3-livefans-setlists-summary.json");

const setlistHeaders = [
  "event_slug", "performance_label", "setlist_title", "completeness", "confidence", "position", "section",
  "display_title", "song_slug", "song_title", "song_aliases", "song_first_release_date", "original_artist",
  "version_slug", "version_title", "version_label", "artist_credit", "medley_group", "source_url",
  "setlist_notes", "song_notes", "entry_notes",
];

const releaseHeaders = [
  "release_slug", "release_title", "release_type", "release_date", "catalog_number", "edition", "disc_number",
  "track_number", "display_title", "song_slug", "song_title", "song_aliases", "song_first_release_date",
  "original_artist", "version_slug", "version_title", "version_label", "version_release_date", "artist_credit",
  "parent_version_slug", "parent_version_title", "parent_version_label", "parent_artist_credit", "parent_release_date",
  "relation_type", "source_url", "release_notes", "song_notes", "version_notes", "track_notes",
];

const existingSetlistSourceIds = new Set([
  "1868471", // 2025-11-03 Liberation Protocol 大阪公演已由专用导入脚本收录。
]);

const fullFripsideEventIds = new Set([
  "1615085", // 20th Anniversary Festival: all three fripSide phases are the event itself.
]);

const songAliases = new Map([
  ["level5 judgelight", "level5-judgelight"],
  ["distance to starry sky", "distance-to-starry-sky"],
  ["distance to the starry sky", "distance-to-starry-sky"],
  ["wandering traveler", "wandering-traveler"],
  ["wandering traveller", "wandering-traveler"],
  ["turn night into day", "turn-night-into-day"],
  ["secret operation", "secret-operation"],
  ["sisters noise", "sisters-noise"],
]);

const autumn2024BaseTracks = [
  ["Starlit Moment", ""],
  ["Unbroken Resolve", ""],
  ["Solitude in Autumn", ""],
  ["Winterfade", ""],
  ["Gratitude to You", "Vocal: 阿部寿世"],
  ["Twinkle Star Nights", ""],
  ["Salvation", "Vocal: 上杉真央"],
  ["killing bites", "-version2024-"],
  ["Regeneration", ""],
  ["black bullet", ""],
  ["Against the World", ""],
  ["Turn Night Into Day", ""],
  ["an Effect of Fate", ""],
  ["only my railgun", "-version2024-"],
  ["Hesitation Snow", "-version2024-"],
  ["Secret Operation -fripSide Edition-", ""],
  ["infinite Resonance", ""],
  ["Red Liberation", ""],
  ["future gazer", "-version2024-"],
  ["dawn of infinity", ""],
];

function supplementalTourSource({ eventId, date, venue, tracks }) {
  return {
    eventId,
    date,
    title: "fripSide concert tour -the Dawn of Resonance- in 2024-2025 supported by animelo",
    tour: "fripSide concert tour -the Dawn of Resonance- in 2024-2025 supported by animelo",
    venue,
    artists: ["fripSide"],
    sourceUrl: "https://ameblo.jp/pyonbc/entry-12873158913.html",
    sourceKind: "eyewitness-report",
    sourceNotes: "曲序来自同时参加松江、冈山两场的观众记录；文章列出 20 首完整曲序，并明确说明冈山场将松江场第 9、10 首 Regeneration / black bullet 替换为 sister's noise / magicaride。本站按第三方现场记录标记为 reported。",
    tracks: tracks.map(([title, memo], index) => ({
      position: index + 1,
      title,
      memo,
      artistCredit: "",
      sectionNote: "",
    })),
  };
}

const supplementalSources = [
  supplementalTourSource({
    eventId: "eyewitness-2024-10-26-matsue",
    date: "2024-10-26",
    venue: "松江 AZTiC canova",
    tracks: autumn2024BaseTracks,
  }),
  supplementalTourSource({
    eventId: "eyewitness-2024-10-27-okayama",
    date: "2024-10-27",
    venue: "CRAZYMAMA KINGDOM",
    tracks: autumn2024BaseTracks.map((track, index) => {
      if (index === 8) return ["sister's noise", ""];
      if (index === 9) return ["magicaride", ""];
      return track;
    }),
  }),
];

function parseCsv(text) {
  const rows = [];
  let row = [];
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

function csvCell(value) {
  const text = String(value ?? "");
  return /[\n\r,"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function normalize(value = "") {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\[.*?\]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripVersion(value) {
  return value
    .replace(/\s*[-(]?\s*(?:version|ver\.?)[\s-]*(?:20\d{2}|2022|2023|2024|2025)\s*[-)]?\s*$/i, "")
    .replace(/\s*-?\s*15th\s+anniversary\s+version\s*-?\s*$/i, "")
    .trim();
}

function slugify(value) {
  const slug = normalize(stripVersion(value)).replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
  return slug || `live-only-${Buffer.from(value).toString("hex").slice(0, 24)}`;
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function objectRows(text) {
  const [headers, ...rows] = parseCsv(text);
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""])));
}

const [research, events, discographyText] = await Promise.all([
  readFile(researchPath, "utf8").then(JSON.parse),
  readFile(eventsPath, "utf8").then(JSON.parse),
  readFile(discographyPath, "utf8"),
]);

const discography = objectRows(discographyText);
const songsBySlug = new Map();
const songsByName = new Map();
const versionsByName = new Map();
const versionsBySong = new Map();

for (const row of discography) {
  if (!songsBySlug.has(row.song_slug)) {
    songsBySlug.set(row.song_slug, {
      slug: row.song_slug,
      title: row.song_title,
      firstReleaseDate: row.song_first_release_date,
      originalArtist: row.original_artist || "fripSide",
    });
  }

  for (const name of [row.song_title, ...(row.song_aliases || "").split(/[|;]/)]) {
    if (name) songsByName.set(normalize(name), songsBySlug.get(row.song_slug));
  }

  if (row.version_slug) {
    const version = {
      slug: row.version_slug,
      songSlug: row.song_slug,
      title: row.version_title || row.display_title || row.song_title,
      label: row.version_label,
      artistCredit: row.artist_credit || "fripSide",
    };
    const bucket = versionsBySong.get(row.song_slug) ?? new Map();
    bucket.set(version.slug, version);
    versionsBySong.set(row.song_slug, bucket);
    for (const name of [row.version_title, row.display_title]) {
      if (!name) continue;
      const key = normalize(name);
      const candidates = versionsByName.get(key) ?? new Map();
      candidates.set(version.slug, version);
      versionsByName.set(key, candidates);
    }
  }
}

function findSongAndVersion(track) {
  const explicitDisplay = track.memo && /(?:version|ver\.?)[\s-]*20\d{2}/i.test(track.memo)
    ? `${track.title} ${track.memo}`
    : track.title;
  const versionCandidates = [...(versionsByName.get(normalize(explicitDisplay))?.values() ?? [])]
    .filter((candidate) => !/instrumental/i.test(`${candidate.title} ${candidate.label}`));
  let version = versionCandidates.length === 1 ? versionCandidates[0] : null;

  const baseTitle = stripVersion(track.title);
  const normalizedBase = normalize(baseTitle);
  let song = version ? songsBySlug.get(version.songSlug) : songsByName.get(normalizedBase);
  if (!song) {
    const aliasSlug = songAliases.get(normalizedBase);
    if (aliasSlug) song = songsBySlug.get(aliasSlug);
  }

  if (!song) {
    const slug = slugify(baseTitle);
    song = {
      slug,
      title: baseTitle,
      firstReleaseDate: "",
      originalArtist: track.artistCredit || "fripSide",
      liveOnly: true,
    };
  }

  if (!version) {
    const candidates = [...(versionsBySong.get(song.slug)?.values() ?? [])]
      .filter((candidate) => !/instrumental/i.test(`${candidate.title} ${candidate.label}`));
    if (candidates.length === 1) version = candidates[0];
  }

  return { song, version, displayTitle: explicitDisplay };
}

function sourceTracksForEvent(source) {
  const uniqueArtists = [...new Set(source.artists.map((artist) => artist.trim()).filter(Boolean))];
  const isSolo = uniqueArtists.length === 1 && /^fripSide$/i.test(uniqueArtists[0]);
  let tracks = source.tracks;

  if (!isSolo && !fullFripsideEventIds.has(source.eventId)) {
    tracks = tracks.filter((track) => /^fripSide$/i.test(track.artistCredit.trim()));
  }

  return tracks.filter((track) => !/映像/.test(`${track.memo} ${track.sectionNote}`));
}

function findEvent(source) {
  const candidates = events.filter((event) => event.category === "LIVE" && event.start_date === source.date && event.status !== "cancelled");
  if (candidates.length === 1) return candidates[0];

  const venueKey = normalize(source.venue);
  const venueMatches = candidates.filter((event) => normalize(`${event.title} ${event.venue}`).includes(venueKey));
  if (venueMatches.length === 1) return venueMatches[0];
  throw new Error(`无法唯一匹配活动：${source.date} ${source.venue}（候选 ${candidates.length}）`);
}

const rows = [];
const setlistReport = [];
const newLiveOnlySongs = new Map();

for (const source of [...research.events, ...supplementalSources]) {
  if (existingSetlistSourceIds.has(source.eventId)) continue;
  const event = findEvent(source);
  const tracks = sourceTracksForEvent(source);
  if (!tracks.length) continue;

  const mixedEvent = !fullFripsideEventIds.has(source.eventId) && (
    new Set(source.artists).size > 1
    || /ANIMAX|Animelo Summer|リスアニ|超音楽祭/i.test(source.title)
  );
  const performanceLabel = mixedEvent ? "fripSide出演枠" : "本公演";
  const title = mixedEvent ? `${source.title} · fripSide出演枠` : source.title;
  const setlistNotes = source.sourceNotes
    || "曲序来自 LiveFans 用户投稿；该来源明确提示公演及歌单信息不保证准确性。本站仅关联页面明确写出的版本，拼盘公演仅收录明确标为 fripSide 的出演段落。";

  tracks.forEach((track, index) => {
    const { song, version, displayTitle } = findSongAndVersion(track);
    const entryNotes = [];
    if (track.memo && !/(?:version|ver\.?)[\s-]*20\d{2}/i.test(track.memo)) entryNotes.push(track.memo);
    if (track.artistCredit && !/^fripSide$/i.test(track.artistCredit)) entryNotes.push(`演出：${track.artistCredit}`);
    if (song.liveOnly) newLiveOnlySongs.set(song.slug, song);
    rows.push([
      event.slug,
      performanceLabel,
      title,
      "complete",
      "reported",
      index + 1,
      "main",
      displayTitle,
      song.slug,
      song.title,
      "",
      song.firstReleaseDate,
      song.originalArtist,
      version?.slug ?? "",
      version?.title ?? "",
      version?.label ?? "",
      version?.artistCredit || song.originalArtist || "fripSide",
      "",
      source.sourceUrl,
      setlistNotes,
      song.liveOnly ? "目前仅在 Live 歌单来源中确认，尚未关联本站专辑条目。" : "",
      entryNotes.join("；"),
    ]);
  });

  setlistReport.push({
    event_slug: event.slug,
    date: source.date,
    venue: source.venue,
    source_url: source.sourceUrl,
    livefans_event_id: /^\d+$/.test(source.eventId) ? source.eventId : null,
    source_kind: source.sourceKind || "livefans-user-submission",
    source_track_count: source.tracks.length,
    imported_track_count: tracks.length,
    performance_label: performanceLabel,
  });
}

const duplicateKeys = rows.map((row) => `${row[0]}|${row[1]}|${row[5]}`);
if (new Set(duplicateKeys).size !== duplicateKeys.length) throw new Error("生成的歌单位置存在重复");

const report = {
  generated_at: new Date().toISOString(),
  status: "ready",
  source: research.source,
  source_disclaimer: research.disclaimer,
  methodology: [
    "从 LiveFans 的 fripSide 歌单检索分页枚举公开页面，并逐页解析曲序、标题、版本备注和演出者。",
    "单独公演收录完整曲序；拼盘活动仅保留页面演出者严格标为 fripSide 的曲目。",
    "页面明确标为 OP/回顾映像的条目不计作现场演唱。",
    "仅在来源明确写出版本名时关联歌曲版本；若歌曲库中仅存在一个版本，则直接关联该唯一版本。",
    "LiveFans 内容为用户投稿，因此所有本批歌单使用 confidence=reported。",
    "松江、冈山两场使用同时参加两场的观众逐曲记录，并按文章明确写出的两首日替换差异分别建表。",
  ],
  setlist_count: setlistReport.length,
  entry_count: rows.length,
  new_live_only_song_count: newLiveOnlySongs.size,
  new_live_only_songs: [...newLiveOnlySongs.values()],
  setlists: setlistReport,
};

await mkdir(resolve("data/normalized"), { recursive: true });
await mkdir(resolve("data/reports"), { recursive: true });
await writeFile(outputCsv, `${setlistHeaders.map(csvCell).join(",")}\n${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);
await writeFile(emptyReleasesCsv, `${releaseHeaders.join(",")}\n`);
await writeFile(outputReport, `${JSON.stringify(report, null, 2)}\n`);

console.log(`已生成 ${outputCsv}`);
console.log(`歌单 ${report.setlist_count} 场；演唱记录 ${report.entry_count} 条；Live-only 歌曲 ${report.new_live_only_song_count} 首。`);
if (report.new_live_only_song_count) {
  console.log("Live-only：", report.new_live_only_songs.map((song) => `${song.title} [${song.slug}]`).join("；"));
}
