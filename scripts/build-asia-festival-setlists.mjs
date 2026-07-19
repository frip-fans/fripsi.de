import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputCsv = resolve("data/normalized/fripside-asia-festival-setlists.csv");
const outputReport = resolve("data/reports/fripside-asia-festival-setlists-summary.json");

const headers = [
  "event_slug", "performance_label", "setlist_title", "completeness", "confidence", "position", "section",
  "display_title", "song_slug", "song_title", "song_aliases", "song_first_release_date", "original_artist",
  "version_slug", "version_title", "version_label", "artist_credit", "medley_group", "source_url",
  "setlist_notes", "song_notes", "entry_notes",
];

const songs = {
  "black-bullet": "black bullet",
  "dawn-of-infinity": "dawn of infinity",
  "eternal-reality": "eternal reality",
  "future-gazer": "future gazer",
  "level5-judgelight": "LEVEL5-judgelight-",
  "only-my-railgun": "only my railgun",
  "phase-next": "PHASE NEXT",
  "red-liberation": "Red Liberation",
  "secret-operation": "Secret Operation",
  "sisters-noise": "sister's noise",
  "two-souls-toward-the-truth": "Two souls -toward the truth-",
  "turn-night-into-day": "Turn Night Into Day",
  "way-to-answer": "way to answer",
  "when-chance-strikes": "when chance strikes",
};

const versions = {
  "black-bullet-version-2023": ["black bullet -version2023-", "version 2023"],
  "eternal-reality-version-2025": ["eternal reality -version2025-", "version 2025"],
  "level5-judgelight-version-2022": ["LEVEL5-judgelight- -version 2022-", "version 2022"],
  "only-my-railgun-version-2024": ["only my railgun -version2024-", "version 2024"],
  "secret-operation-fripside-edition": ["Secret Operation -fripSide Edition-", "fripSide Edition"],
  "two-souls-toward-the-truth-version-2023": ["Two souls -toward the truth- -version2023-", "version 2023"],
  "way-to-answer-version-2025": ["way to answer -version2025-", "version 2025"],
};

const manifests = [
  {
    eventSlug: "2025-07-13-live-2025",
    title: "リスアニ！LIVE 2025 ナツヤスミ · fripSide出演枠",
    date: "2025-07-13",
    venue: "パシフィコ横浜 国立大ホール",
    confidence: "reported",
    sourceUrl: "https://www.lisani.jp/0000287146/",
    sourceKind: "用户提供的现场歌单与リスアニ！官方 DAY2 报告",
    notes: "曲序与版本标题来自用户提供的现场歌单，并与リスアニ！官方 DAY2 报告核对活动信息；按现场记录收录。",
    entries: [
      ["LEVEL5-judgelight- -version 2022-", "level5-judgelight", "level5-judgelight-version-2022"],
      ["way to answer -version 2025-", "way-to-answer", "way-to-answer-version-2025"],
      ["Turn Night Into Day", "turn-night-into-day"],
      ["Red Liberation", "red-liberation"],
    ],
  },
  {
    eventSlug: "2025-11-22-live-taipei-2025-saturday-stage",
    title: "リスアニ！LIVE TAIPEI 2025 · fripSide出演枠",
    date: "2025-11-22",
    venue: "国立台湾大学総合体育館 1F",
    confidence: "official",
    sourceUrl: "https://www.lisani.jp/0000296036/",
    sourceKind: "リスアニ！官方全场歌单报告",
    notes: "曲序与版本标题来自リスアニ！官方全场歌单报告；本站仅收录 fripSide 出演段落。",
    entries: [
      ["LEVEL5-judgelight- -version 2022-", "level5-judgelight", "level5-judgelight-version-2022"],
      ["eternal reality -version 2025-", "eternal-reality", "eternal-reality-version-2025"],
      ["dawn of infinity", "dawn-of-infinity"],
      ["black bullet -version 2023-", "black-bullet", "black-bullet-version-2023"],
      ["only my railgun -version 2024-", "only-my-railgun", "only-my-railgun-version-2024"],
      ["Red Liberation", "red-liberation"],
    ],
  },
  {
    eventSlug: "2026-03-07-animax-musix-2026-osaka-asue",
    title: "ANIMAX MUSIX 2026 OSAKA · fripSide出演枠",
    date: "2026-03-07",
    venue: "Asue アリーナ大阪",
    confidence: "official",
    sourceUrl: "https://www.animax.co.jp/sites/jp.animax/files/press-release/20260313.pdf",
    sourceKind: "ANIMAX MUSIX 官方公演报告",
    notes: "两首完整出演曲目来自 ANIMAX MUSIX 官方公演报告；PHASE NEXT 未标注具体编曲版本，因此保留作品级关联。",
    entries: [
      ["Two souls -toward the truth- -version2023-", "two-souls-toward-the-truth", "two-souls-toward-the-truth-version-2023"],
      ["PHASE NEXT", "phase-next"],
    ],
  },
  {
    eventSlug: "2026-05-23-loft-e3ad20d1",
    title: "リスアニ！ナイト Vol.11 · fripSide出演枠",
    date: "2026-05-23",
    venue: "新宿LOFT",
    confidence: "reported",
    sourceUrl: "https://fripside.net/contents/1073966",
    sourceKind: "用户提供的现场歌单与 fripSide 官方活动公告",
    notes: "五首曲序与整段 Medley 结构来自用户提供的现场记录；活动日期、场馆与出演者由 fripSide 官方公告核对。",
    entries: [
      ["sister's noise", "sisters-noise", "", "01"],
      ["future gazer", "future-gazer", "", "01"],
      ["only my railgun", "only-my-railgun", "", "01"],
      ["when chance strikes", "when-chance-strikes", "", "01"],
      ["Red Liberation", "red-liberation", "", "01"],
    ],
  },
  {
    eventSlug: "2026-06-21-luminous-lodge-06-6feaa33a",
    title: "Luminous Lodge 06 · fripSide出演枠",
    date: "2026-06-21",
    venue: "香港・旺角 マクファーソンスタジアム",
    confidence: "reported",
    sourceUrl: "https://oohashiayaka-a9h0bqgtdec3g6as.japaneast-01.azurewebsites.net/Events/Articles?sortOrder=date_desc",
    sourceKind: "现场观众歌单与公开社区整理",
    notes: "曲序来自现场观众发布的歌单截图，并与公开社区整理交叉核对；完整性与版本标题按现场记录收录。",
    entries: [
      ["only my railgun -version 2024-", "only-my-railgun", "only-my-railgun-version-2024"],
      ["Secret Operation (-fripSide Edition-)", "secret-operation", "secret-operation-fripside-edition"],
      ["black bullet -version2023-", "black-bullet", "black-bullet-version-2023"],
      ["dawn of infinity", "dawn-of-infinity"],
      ["Two souls -toward the truth- -version2023-", "two-souls-toward-the-truth", "two-souls-toward-the-truth-version-2023"],
      ["Red Liberation", "red-liberation"],
    ],
  },
];

function csvCell(value) {
  const text = String(value ?? "");
  return /[\n\r,"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const rows = [];
for (const manifest of manifests) {
  manifest.entries.forEach(([displayTitle, songSlug, versionSlug = "", medleyGroup = "", entryNotes = ""], index) => {
    const songTitle = songs[songSlug];
    if (!songTitle) throw new Error(`缺少歌曲定义：${songSlug}`);
    const version = versionSlug ? versions[versionSlug] : null;
    if (versionSlug && !version) throw new Error(`缺少版本定义：${versionSlug}`);

    rows.push([
      manifest.eventSlug,
      "fripSide出演枠",
      manifest.title,
      "complete",
      manifest.confidence,
      index + 1,
      "main",
      displayTitle,
      songSlug,
      songTitle,
      "",
      "",
      "fripSide",
      versionSlug,
      version?.[0] ?? "",
      version?.[1] ?? "",
      version ? "fripSide" : "",
      medleyGroup,
      manifest.sourceUrl,
      manifest.notes,
      "",
      entryNotes,
    ]);
  });
}

const report = {
  generated_at: new Date().toISOString(),
  status: "ready",
  scope: "2025–2026 年五场亚洲拼盘活动的 fripSide 出演段落",
  methodology: [
    "活动日期、地点与类型复用本站已有 events 记录；五场均为 classification=拼盘。",
    "台北场曲序和版本标题来自リスアニ！官方完整歌单报告，因此 confidence=official。",
    "香港场曲序来自用户提供的现场歌单截图，并与公开社区整理交叉核对，因此 confidence=reported。",
    "横滨与リスアニ！ナイト曲序来自用户提供的现场记录，并用主办方或 fripSide 官方报告核对活动信息，因此 confidence=reported。",
    "ANIMAX MUSIX 两首完整出演曲目由官方公演报告确认，因此 confidence=official、completeness=complete。",
    "只有来源明确写出版本名的曲目才关联 performed_version_id；裸歌名不推断现场编曲版本。",
    "リスアニ！ナイト的五首组成曲保留为独立演唱记录，并以共享 medley_group=01 表示同一串烧。",
  ],
  setlists: manifests.map((manifest) => ({
    event_slug: manifest.eventSlug,
    date: manifest.date,
    venue: manifest.venue,
    confidence: manifest.confidence,
    source_kind: manifest.sourceKind,
    source_url: manifest.sourceUrl,
    entry_count: manifest.entries.length,
    explicit_version_count: manifest.entries.filter((entry) => entry[2]).length,
    medley_groups: [...new Set(manifest.entries.map((entry) => entry[3]).filter(Boolean))],
  })),
  corroborating_sources: {
    taipei_event: "https://fripside.net/contents/975232",
    hong_kong_event: "https://fripside.net/contents/1071163",
    hong_kong_setlist_post_search: "https://search.yahoo.co.jp/realtime/search?ei=UTF-8&md=h&p=%23LL06&rkf=1",
    yokohama_event: "https://fripside.net/contents/932808",
    lisani_night_event: "https://www.lisani.jp/0000308914/",
    animax_event: "https://www.animax.co.jp/animaxmusix/osaka/about.html",
  },
};

await mkdir(resolve("data/normalized"), { recursive: true });
await mkdir(resolve("data/reports"), { recursive: true });
await writeFile(outputCsv, `${headers.map(csvCell).join(",")}\n${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);
await writeFile(outputReport, `${JSON.stringify(report, null, 2)}\n`);

console.log(`已生成 ${outputCsv}`);
console.log(`已生成 ${outputReport}`);
console.log(`歌单 ${manifests.length} 份；曲目 ${rows.length} 条；明确版本 ${report.setlists.reduce((sum, item) => sum + item.explicit_version_count, 0)} 条；Medley ${report.setlists.reduce((sum, item) => sum + item.medley_groups.length, 0)} 组。`);
