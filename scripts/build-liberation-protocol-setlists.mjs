import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputCsv = resolve("data/normalized/fripside-liberation-protocol-livefans-setlists.csv");
const outputReport = resolve("data/reports/fripside-liberation-protocol-setlists-summary.json");

const headers = [
  "event_slug",
  "performance_label",
  "setlist_title",
  "completeness",
  "confidence",
  "position",
  "section",
  "display_title",
  "song_slug",
  "song_title",
  "song_aliases",
  "song_first_release_date",
  "original_artist",
  "version_slug",
  "version_title",
  "version_label",
  "artist_credit",
  "medley_group",
  "source_url",
  "setlist_notes",
  "song_notes",
  "entry_notes",
];

const songs = {
  "2016-third-cosmic-velocity": ["2016 -Third cosmic velocity-", "2016-10-05"],
  "an-effect-of-fate": ["an Effect of Fate", ""],
  "dawn-of-infinity": ["dawn of infinity", ""],
  distance: ["Distance", ""],
  "distance-to-starry-sky": ["Distance to starry sky", ""],
  "dual-existence": ["dual existence", ""],
  "echoes-of-the-stars": ["Echoes of the Stars", "2025-07-07"],
  "eternal-reality": ["eternal reality", ""],
  "final-phase": ["final phase", ""],
  flames: ["Flames", ""],
  "freezing-rain": ["Freezing rain", ""],
  "future-gazer": ["future gazer", ""],
  "infinite-resonance": ["infinite Resonance", ""],
  "insoluble-snow": ["Insoluble Snow", ""],
  "invisible-wings": ["Invisible Wings", ""],
  "level5-judgelight": ["LEVEL5-judgelight-", ""],
  "more-than-you-know": ["more than you know", "2023-10-11"],
  newage: ["Newage", ""],
  "only-my-railgun": ["only my railgun", ""],
  "phase-next": ["PHASE NEXT", ""],
  "reach-for-the-light": ["Reach for the light", ""],
  "red-liberation": ["Red Liberation", ""],
  "secret-operation": ["Secret Operation", ""],
  "sisters-noise": ["sister's noise", ""],
  sky: ["sky", "2004-03-28"],
  "starlit-moment": ["Starlit Moment", ""],
  "turn-night-into-day": ["Turn Night Into Day", ""],
  "unbroken-resolve": ["Unbroken Resolve", ""],
  "wandering-traveler": ["Wandering Traveler", ""],
  "way-to-answer": ["way to answer", ""],
  winterfade: ["Winterfade", ""],
  "with-a-smile": ["with a smile", ""],
};

const versions = {
  "dual-existence-version-2023": ["dual existence -version2023-", "version 2023"],
  "eternal-reality-version-2025": ["eternal reality -version2025-", "version 2025"],
  "final-phase-version-2023": ["final phase -version2023-", "version 2023"],
  "future-gazer-version-2024": ["future gazer -version2024-", "version 2024"],
  "level5-judgelight-version-2022": ["LEVEL5-judgelight- -version 2022-", "version 2022"],
  "only-my-railgun-version-2024": ["only my railgun -version2024-", "version 2024"],
  "secret-operation-fripside-edition": ["Secret Operation -fripSide Edition-", "fripSide Edition"],
  "sisters-noise-version-2022": ["sister's noise -version 2022-", "version 2022"],
  "way-to-answer-version-2025": ["way to answer -version2025-", "version 2025"],
};

const tokyo = [
  ["2016 -Third cosmic velocity-", "2016-third-cosmic-velocity"],
  ["Invisible Wings", "invisible-wings"],
  ["Unbroken Resolve", "unbroken-resolve"],
  ["sister's noise -version2022-", "sisters-noise", "sisters-noise-version-2022"],
  ["eternal reality -version2025-", "eternal-reality", "eternal-reality-version-2025"],
  ["future gazer -version2024-", "future-gazer", "future-gazer-version-2024", "01"],
  ["LEVEL5-judgelight- -version2022-", "level5-judgelight", "level5-judgelight-version-2022", "01"],
  ["dual existence -version2023-", "dual-existence", "dual-existence-version-2023", "01"],
  ["final phase-version2023-", "final-phase", "final-phase-version-2023", "01"],
  ["Echoes of the Stars", "echoes-of-the-stars"],
  ["Insoluble Snow", "insoluble-snow"],
  ["Winterfade", "winterfade"],
  ["Secret Operation -fripSide Edition-", "secret-operation", "secret-operation-fripside-edition"],
  ["with a smile", "with-a-smile", "", "02"],
  ["Wandering Traveler", "wandering-traveler", "", "02"],
  ["Reach for the light", "reach-for-the-light", "", "03"],
  ["Distance to starry sky", "distance-to-starry-sky", "", "03"],
  ["Newage", "newage"],
  ["more than you know", "more-than-you-know"],
  ["Turn Night into Day", "turn-night-into-day"],
  ["an effect of fate", "an-effect-of-fate"],
  ["way to answer -version2025-", "way-to-answer", "way-to-answer-version-2025"],
  ["PHASE NEXT", "phase-next"],
  ["only my railgun -version2024-", "only-my-railgun", "only-my-railgun-version-2024"],
  ["sky", "sky"],
  ["Red Liberation", "red-liberation"],
  ["dawn of infinity", "dawn-of-infinity", "", "04"],
  ["infinite Resonance", "infinite-resonance", "", "04"],
];

const osaka = [
  ["Flames", "flames"],
  ["LEVEL5-judgelight--version 2022-", "level5-judgelight", "level5-judgelight-version-2022"],
  ["Unbroken Resolve", "unbroken-resolve"],
  ["Starlit Moment", "starlit-moment"],
  ["eternal reality -version 2025-", "eternal-reality", "eternal-reality-version-2025"],
  ["Winterfade", "winterfade"],
  ["Freezing rain", "freezing-rain"],
  ["Echoes of the Stars", "echoes-of-the-stars"],
  ["Secret Operation-fripSide Edition-", "secret-operation", "secret-operation-fripside-edition"],
  ["2016 -Third cosmic velocity-", "2016-third-cosmic-velocity"],
  ["Wandering Traveler", "wandering-traveler"],
  ["Distance", "distance"],
  ["Distance to starry sky", "distance-to-starry-sky"],
  ["Newage", "newage"],
  ["more than you know", "more-than-you-know"],
  ["Turn Night Into Day", "turn-night-into-day"],
  ["an Effect of Fate", "an-effect-of-fate"],
  ["way to answer -version 2025-", "way-to-answer", "way-to-answer-version-2025"],
  ["PHASE NEXT", "phase-next"],
  ["only my railgun -version 2024-", "only-my-railgun", "only-my-railgun-version-2024"],
  ["sky", "sky"],
  ["Red Liberation", "red-liberation"],
  ["dawn of infinity", "dawn-of-infinity"],
  ["infinite Resonance", "infinite-resonance"],
];

const manifests = [
  {
    eventSlug: "2025-11-03-fripside-concert-tour-2025-2026-liberation-protocol-supported-by-animelo",
    title: "Liberation Protocol · 大阪公演",
    sourceUrl: "https://www.livefans.jp/events/1868471",
    venue: "大阪国際交流センター 大ホール",
    date: "2025-11-03",
    entries: osaka,
  },
  {
    eventSlug: "2026-01-04-fripside-concert-tour-2025-2026-liberation-protocol-supported-by-animelo-tachikawa-stage-garden",
    title: "Liberation Protocol · 東京公演",
    sourceUrl: "https://www.livefans.jp/events/1868023",
    venue: "TACHIKAWA STAGE GARDEN",
    date: "2026-01-04",
    entries: tokyo,
  },
];

const notes = "曲序来自 LiveFans 用户投稿；本站按现场记录收录。该来源明确提示其公演及歌单信息不保证准确性。";

function csvCell(value) {
  const text = String(value ?? "");
  return /[\n\r,"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const rows = [];
for (const manifest of manifests) {
  manifest.entries.forEach(([displayTitle, songSlug, versionSlug = "", medleyGroup = ""], index) => {
    const song = songs[songSlug];
    if (!song) throw new Error(`缺少歌曲定义：${songSlug}`);
    const version = versionSlug ? versions[versionSlug] : null;
    if (versionSlug && !version) throw new Error(`缺少版本定义：${versionSlug}`);
    rows.push([
      manifest.eventSlug,
      "本公演",
      manifest.title,
      "complete",
      "reported",
      index + 1,
      "main",
      displayTitle,
      songSlug,
      song[0],
      "",
      song[1],
      "fripSide",
      versionSlug,
      version?.[0] ?? "",
      version?.[1] ?? "",
      version ? "fripSide" : "",
      medleyGroup,
      manifest.sourceUrl,
      notes,
      "",
      medleyGroup ? `LiveFans 页面标记为 Medley ${medleyGroup} 的组成曲。` : "",
    ]);
  });
}

const report = {
  generated_at: new Date().toISOString(),
  status: "ready",
  scope: "fripSide concert tour 2025→2026 -Liberation Protocol- 的首批两场 Live 歌单",
  methodology: [
    "日期、地点和演出标题与本站既有活动记录及 fripSide 官方巡演公告核对。",
    "曲序、标题拼写和 Medley 边界来自 LiveFans 页面中的歌单表格结构。",
    "LiveFans 将歌单标注为用户投稿，因此 confidence 使用 reported，而不是 official。",
    "只有来源标题明确写出版本名时才关联 performed_version；其余曲目不推断现场编曲版本。",
    "Medley 的每首组成曲仍保存为独立演唱记录，并通过 medley_group 保留串烧关系。",
  ],
  setlists: manifests.map((manifest) => ({
    event_slug: manifest.eventSlug,
    date: manifest.date,
    venue: manifest.venue,
    source_url: manifest.sourceUrl,
    entry_count: manifest.entries.length,
    medleys: [...new Set(manifest.entries.map((entry) => entry[3]).filter(Boolean))].map((group) => ({
      group,
      tracks: manifest.entries.filter((entry) => entry[3] === group).map((entry) => entry[0]),
    })),
  })),
  new_song_metadata_sources: [
    { song: "2016 -Third cosmic velocity-", url: "https://fripside.net/musics/11756" },
    { song: "Echoes of the Stars", url: "https://fripside.net/musics/19112" },
    { song: "more than you know", url: "https://fripside.net/musics/13820" },
    { song: "sky", url: "https://fripside.net/musics/11703" },
  ],
  official_tour_source: "https://fripside.net/contents/995086",
};

await mkdir(resolve("data/normalized"), { recursive: true });
await mkdir(resolve("data/reports"), { recursive: true });
await writeFile(outputCsv, `${headers.map(csvCell).join(",")}\n${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);
await writeFile(outputReport, `${JSON.stringify(report, null, 2)}\n`);

console.log(`已生成 ${outputCsv}`);
console.log(`已生成 ${outputReport}`);
console.log(`歌单 ${manifests.length} 份；曲目 ${rows.length} 条；Medley ${report.setlists.reduce((sum, item) => sum + item.medleys.length, 0)} 组。`);
