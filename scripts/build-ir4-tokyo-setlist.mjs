import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputCsv = resolve("data/normalized/fripside-ir4-tour-tokyo-setlist.csv");
const outputReport = resolve("data/reports/fripside-ir4-tour-tokyo-setlist-summary.json");

const headers = [
  "event_slug", "performance_label", "setlist_title", "completeness", "confidence", "position", "section",
  "display_title", "song_slug", "song_title", "song_aliases", "song_first_release_date", "original_artist",
  "version_slug", "version_title", "version_label", "artist_credit", "medley_group", "source_url",
  "setlist_notes", "song_notes", "entry_notes",
];

// 导入会用这里的标题与 original_artist 覆盖已有 songs 行，因此逐首照抄线上曲库（完整 discography 数据集）的现值。
const songs = {
  "across-the-changing-sky": ["Across the Changing Sky", "fripSide"],
  blackfox: ["BLACKFOX", "fripSide"],
  "bound-in-the-melody": ["Bound in the Melody", "fripSide"],
  "brand-new-me": ["Brand New Me!", "fripSide"],
  "find-the-way": ["Find the Way", "fripSide"],
  "my-own-way": ["My Own Way", "fripSide"],
  nostalgia: ["nostalgia", "fripSide (Phase 1)"],
  "only-my-railgun": ["only my railgun", "fripSide (Phase 2)"],
  "our-last-place": ["Our Last Place", "fripSide"],
  "phase-next": ["PHASE NEXT", "fripSide"],
  "rebuild-the-order-of-stars": ["Re:build the Order of Stars", "fripSide"],
  "red-liberation": ["Red Liberation", "fripSide"],
  "secret-operation": ["Secret Operation", "fripSide"],
  "sisters-noise": ["sister's noise", "fripSide (Phase 2)"],
  "starlit-moment": ["Starlit Moment", "fripSide"],
  "the-edge-of-reality": ["The Edge of Reality", "fripSide"],
  "turn-night-into-day": ["Turn Night Into Day", "fripSide"],
  "unwavering-one-thing": ["unwavering One thing", "fripSide (Mao Uesugi vocal)"],
  "wandering-traveler": ["Wandering Traveler", "fripSide (Hisayo Abe vocal)"],
  "where-the-light-leads-us": ["Where the Light Leads Us", "fripSide"],
  "where-we-belong": ["Where We Belong", "fripSide"],
};

const versions = {
  "blackfox-version-2022": ["BLACKFOX -version 2022-", "version 2022"],
  "my-own-way-version-2026": ["My Own Way -version2026-", "version 2026"],
  "nostalgia-version-2026": ["nostalgia -version2026-", "version 2026"],
  "only-my-railgun-version-2024": ["only my railgun -version2024-", "version 2024"],
  "phase-next-ir4-version": ["PHASE NEXT -iR4 version-", "iR4 version"],
  "secret-operation-fripside-edition": ["Secret Operation -fripSide Edition-", "fripSide Edition"],
  "sisters-noise-version-2022": ["sister's noise -version 2022-", "version 2022"],
};

const manifest = {
  eventSlug: "2026-09-21-animeblast-presents-fripside-concert-tour-2026-2027-infinite-resonance-4-line-cube-shibuya-06d71308",
  title: "infinite Resonance 4 Tour 2026–2027 · 東京",
  date: "2026-09-21",
  venue: "LINE CUBE SHIBUYA",
  sourceUrl: "https://www.lisani.jp/0000319029/2/",
  entries: [
    ["Where the Light Leads Us", "where-the-light-leads-us"],
    ["Brand New Me!", "brand-new-me"],
    ["Re:build the Order of Stars", "rebuild-the-order-of-stars"],
    ["My Own Way -version2026-", "my-own-way", "my-own-way-version-2026"],
    ["Where We Belong", "where-we-belong"],
    ["unwavering One thing", "unwavering-one-thing"],
    ["Wandering traveler", "wandering-traveler"],
    ["Secret Operation -fripSide Edition-", "secret-operation", "secret-operation-fripside-edition"],
    ["Starlit Moment", "starlit-moment"],
    ["Across the Changing Sky", "across-the-changing-sky"],
    ["Our Last Place", "our-last-place"],
    ["nostalgia -version 2026-", "nostalgia", "nostalgia-version-2026"],
    ["Find the Way", "find-the-way"],
    ["Turn Night Into Day", "turn-night-into-day"],
    ["BLACKFOX -version 2022-", "blackfox", "blackfox-version-2022", "main", "リスアニ！报告标注为本巡演的日替曲。"],
    ["sister’s noise -version 2022-", "sisters-noise", "sisters-noise-version-2022"],
    ["The Edge of Reality", "the-edge-of-reality"],
    ["Red Liberation", "red-liberation"],
    ["Bound in the Melody", "bound-in-the-melody"],
    ["only my railgun -version2024-", "only-my-railgun", "only-my-railgun-version-2024", "encore"],
    ["PHASE NEXT -iR4 version-", "phase-next", "phase-next-ir4-version", "encore"],
  ],
};

function csvCell(value) {
  const text = String(value ?? "");
  return /[\n\r,"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const setlistNotes = "曲序、Encore 分段与版本标题来自リスアニ！官方公演报告（巡演首日・东京公演）。";
const rows = manifest.entries.map((entry, index) => {
  const [displayTitle, songSlug, versionSlug = "", section = "main", entryNotes = ""] = entry;
  const song = songs[songSlug];
  if (!song) throw new Error(`缺少歌曲定义：${songSlug}`);
  const version = versionSlug ? versions[versionSlug] : null;
  if (versionSlug && !version) throw new Error(`缺少版本定义：${versionSlug}`);

  return [
    manifest.eventSlug,
    "本公演",
    manifest.title,
    "complete",
    "official",
    index + 1,
    section,
    displayTitle,
    songSlug,
    song[0],
    "",
    "",
    song[1],
    versionSlug,
    version?.[0] ?? "",
    version?.[1] ?? "",
    version ? "fripSide" : "",
    "",
    manifest.sourceUrl,
    setlistNotes,
    "",
    entryNotes,
  ];
});

const report = {
  generated_at: new Date().toISOString(),
  status: "ready",
  scope: "fripSide Concert Tour 2026-2027 -infinite Resonance 4- 首日东京公演（2026-09-21 LINE CUBE SHIBUYA）完整歌单",
  methodology: [
    "演出日期、场馆与类型复用本站已有 events 记录，不新建活动。",
    "21 首曲序、19 首本篇与 2 首 Encore 分段均来自リスアニ！官方演出报告，因此 confidence=official。",
    "只有官方标题明确写出版本名的 7 首曲目才关联 performed_version_id。",
    "全部作品与版本均已存在于本站曲库；歌曲标题与 original_artist 照抄线上现值，导入不改变曲库字段。",
    "sister's noise 在线上存在 sisters-noise 与 sister-s-noise 两条作品记录；本歌单沿用已承载历史 Live 记录及 -version 2022- 版本的 sisters-noise。",
    "BLACKFOX -version 2022- 在报告中被标为日替曲，写入 entry notes。",
  ],
  setlist: {
    event_slug: manifest.eventSlug,
    date: manifest.date,
    venue: manifest.venue,
    source_url: manifest.sourceUrl,
    entry_count: rows.length,
    main_count: manifest.entries.filter((entry) => (entry[3] ?? "main") === "main").length,
    encore_count: manifest.entries.filter((entry) => entry[3] === "encore").length,
    explicit_version_count: manifest.entries.filter((entry) => entry[2]).length,
  },
};

await mkdir(resolve("data/normalized"), { recursive: true });
await mkdir(resolve("data/reports"), { recursive: true });
await writeFile(outputCsv, `${headers.map(csvCell).join(",")}\n${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);
await writeFile(outputReport, `${JSON.stringify(report, null, 2)}\n`);

console.log(`已生成 ${outputCsv}`);
console.log(`已生成 ${outputReport}`);
console.log(`歌单 1 份；本篇 ${report.setlist.main_count} 首；Encore ${report.setlist.encore_count} 首；明确版本 ${report.setlist.explicit_version_count} 首。`);
