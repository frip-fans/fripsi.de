import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputCsv = resolve("data/normalized/fripside-dawn-of-resonance-final-setlist.csv");
const outputReport = resolve("data/reports/fripside-dawn-of-resonance-final-setlist-summary.json");

const headers = [
  "event_slug", "performance_label", "setlist_title", "completeness", "confidence", "position", "section",
  "display_title", "song_slug", "song_title", "song_aliases", "song_first_release_date", "original_artist",
  "version_slug", "version_title", "version_label", "artist_credit", "medley_group", "source_url",
  "setlist_notes", "song_notes", "entry_notes",
];

const songs = {
  "an-effect-of-fate": "an Effect of Fate",
  "black-bullet": "black bullet",
  "dawn-of-infinity": "dawn of infinity",
  "freezing-rain": "Freezing rain",
  "hesitation-snow": "Hesitation Snow",
  "infinite-resonance": "infinite Resonance",
  "invisible-wings": "Invisible Wings",
  "killing-bites": "killing bites",
  newage: "Newage",
  "only-my-railgun": "only my railgun",
  "red-liberation": "Red Liberation",
  regeneration: "Regeneration",
  salvation: "Salvation",
  "secret-operation": "Secret Operation",
  "solitude-in-autumn": "Solitude in Autumn",
  "starlit-moment": "Starlit Moment",
  "trust-in-you": "trust in you",
  "turn-night-into-day": "Turn Night Into Day",
  "unbroken-resolve": "Unbroken Resolve",
  "wandering-traveler": "Wandering Traveler",
  "winterfade": "Winterfade",
  "with-a-smile": "with a smile",
  "your-way": "Your Way",
};

const versions = {
  "black-bullet-version-2023": ["black bullet -version2023-", "version 2023"],
  "hesitation-snow-version-2024": ["Hesitation Snow -version2024-", "version 2024"],
  "killing-bites-version-2024": ["killing bites -version2024-", "version 2024"],
  "only-my-railgun-version-2024": ["only my railgun -version2024-", "version 2024"],
  "secret-operation-fripside-edition": ["Secret Operation -fripSide Edition-", "fripSide Edition"],
  "trust-in-you-version-2022": ["trust in you -version 2022-", "version 2022"],
};

const manifest = {
  eventSlug: "2025-02-16-fripside-concert-tour-the-dawn-of-resonance-supported-by-animelo-pit",
  title: "the Dawn of Resonance 2024–2025 · 東京FINAL",
  date: "2025-02-16",
  venue: "豊洲PIT",
  sourceUrl: "https://www.lisani.jp/0000277634/2/",
  entries: [
    ["dawn of infinity", "dawn-of-infinity"],
    ["Regeneration", "regeneration"],
    ["Solitude in Autumn", "solitude-in-autumn"],
    ["Winterfade", "winterfade"],
    ["freezing rain", "freezing-rain"],
    ["Salvation", "salvation", "", "main", "主唱：上杉真央"],
    ["Invisible Wings", "invisible-wings"],
    ["killing bites -version 2024-", "killing-bites", "killing-bites-version-2024"],
    ["Newage", "newage"],
    ["Turn Night Into Day", "turn-night-into-day"],
    ["trust in you -version 2022-", "trust-in-you", "trust-in-you-version-2022"],
    ["with a smile", "with-a-smile", "", "main", "主唱：阿部寿世"],
    ["Wandering traveller", "wandering-traveler", "", "main", "リスアニ！报告标注为演出时的新曲。", "Wandering traveller"],
    ["Hesitation Snow -version 2024-", "hesitation-snow", "hesitation-snow-version-2024"],
    ["black bullet -version 2023-", "black-bullet", "black-bullet-version-2023"],
    ["an Effect of Fate", "an-effect-of-fate"],
    ["Unbroken Resolve", "unbroken-resolve"],
    ["Your way", "your-way"],
    ["Starlit Moment", "starlit-moment"],
    ["Secret Operation -fripSide Edition-", "secret-operation", "secret-operation-fripside-edition"],
    ["infinite Resonance", "infinite-resonance"],
    ["only my railgun -version 2024-", "only-my-railgun", "only-my-railgun-version-2024", "encore"],
    ["Red Liberation", "red-liberation", "", "encore"],
  ],
};

function csvCell(value) {
  const text = String(value ?? "");
  return /[\n\r,"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const setlistNotes = "曲序、Encore 分段、版本标题及单人主唱标注来自リスアニ！官方公演报告。";
const rows = manifest.entries.map((entry, index) => {
  const [displayTitle, songSlug, versionSlug = "", section = "main", entryNotes = "", songAliases = ""] = entry;
  const songTitle = songs[songSlug];
  if (!songTitle) throw new Error(`缺少歌曲定义：${songSlug}`);
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
    songTitle,
    songAliases,
    "",
    "fripSide",
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
  scope: "fripSide 47 都道府県全国ツアー FINAL（2025-02-16 豊洲PIT）完整歌单",
  methodology: [
    "演出日期、场馆与类型复用本站已有 events 记录；classification=专场。",
    "23 首曲序、21 首本篇与 2 首 Encore 分段均来自リスアニ！官方演出报告，因此 confidence=official。",
    "Salvation 与 with a smile 的现场主唱按官方报告写入 entry notes。",
    "只有官方标题明确写出版本名的 6 首曲目才关联 performed_version_id。",
    "Regeneration 尚未进入本站专辑数据集，因此由本歌单先创建作品记录，不虚构录音版本或发行物关联。",
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
  event_source: "https://fripside.net/contents/878928",
};

await mkdir(resolve("data/normalized"), { recursive: true });
await mkdir(resolve("data/reports"), { recursive: true });
await writeFile(outputCsv, `${headers.map(csvCell).join(",")}\n${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);
await writeFile(outputReport, `${JSON.stringify(report, null, 2)}\n`);

console.log(`已生成 ${outputCsv}`);
console.log(`已生成 ${outputReport}`);
console.log(`歌单 1 份；本篇 ${report.setlist.main_count} 首；Encore ${report.setlist.encore_count} 首；明确版本 ${report.setlist.explicit_version_count} 首。`);
