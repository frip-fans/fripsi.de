import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputCsv = resolve("data/normalized/fripside-anisama-2025-2026-setlists.csv");
const outputReport = resolve("data/reports/fripside-anisama-2025-2026-setlists-summary.json");

const headers = [
  "event_slug", "performance_label", "setlist_title", "completeness", "confidence", "position", "section",
  "display_title", "song_slug", "song_title", "song_aliases", "song_first_release_date", "original_artist",
  "version_slug", "version_title", "version_label", "artist_credit", "medley_group", "source_url",
  "setlist_notes", "song_notes", "entry_notes",
];

const songs = {
  "cyber-cyber": { title: "CYBER CYBER", artist: "ALTIMA" },
  "dawn-of-infinity": { title: "dawn of infinity", artist: "fripSide" },
  "future-gazer": { title: "future gazer", artist: "fripSide" },
  gravitation: { title: "Gravitation", artist: "黒崎真音" },
  "ill-believe": { title: "I'll believe", artist: "ALTIMA" },
  "memories-last": { title: "メモリーズ・ラスト", artist: "黒崎真音" },
  "only-my-railgun": { title: "only my railgun", artist: "fripSide" },
  "plasmic-fire": { title: "PLASMIC FIRE", artist: "KOTOKO × ALTIMA" },
  "rakuen-no-tsubasa": { title: "楽園の翼", artist: "黒崎真音" },
  "red-liberation": { title: "Red Liberation", artist: "fripSide" },
  "secret-operation": { title: "Secret Operation", artist: "fripSide" },
  "x-encounter": { title: "X-encounter", artist: "黒崎真音" },
};

const versions = {
  "only-my-railgun-version-2024": ["only my railgun -version2024-", "version 2024"],
  "secret-operation-fripside-edition": ["Secret Operation -fripSide Edition-", "fripSide Edition"],
};

const manifests = [
  {
    eventSlug: "2025-08-29-animelo-summer-live-2025-thanxx",
    title: "Animelo Summer Live 2025 “ThanXX!” · fripSide出演枠",
    sourceUrl: "https://anisama.tv/2025/setlist/",
    date: "2025-08-29",
    venue: "さいたまスーパーアリーナ",
    sourceKind: "Animelo Summer Live 官方完整歌单",
    entries: [
      ["楽園の翼 [黒崎真音]", "rakuen-no-tsubasa", "", "01", "演出：KOTOKO × 上杉真央 × 阿部寿世"],
      ["X-encounter [黒崎真音]", "x-encounter", "", "01", "演出：KOTOKO × 上杉真央 × 阿部寿世"],
      ["PLASMIC FIRE [KOTOKO×ALTIMA]", "plasmic-fire", "", "01", "演出：KOTOKO × 上杉真央 × SAT × MOTSU"],
      ["I'll believe [ALTIMA]", "ill-believe", "", "01", "演出：上杉真央 × SAT × MOTSU"],
      ["CYBER CYBER", "cyber-cyber", "", "01", "演出：阿部寿世 × SAT × MOTSU"],
      ["Gravitation [黒崎真音]", "gravitation", "", "01", "演出：KOTOKO × 阿部寿世 × SAT"],
      ["メモリーズ・ラスト [黒崎真音]", "memories-last", "", "01", "演出：KOTOKO × fripSide"],
      ["Red Liberation", "red-liberation"],
      ["only my railgun -version 2024-", "only-my-railgun", "only-my-railgun-version-2024"],
    ],
  },
  {
    eventSlug: "2026-07-10-animelo-summer-live-2026-messenger-4-6",
    title: "Animelo Summer Live 2026 -Messenger- · fripSide出演枠",
    sourceUrl: "https://anisama.tv/2026/news/article26071001.html",
    date: "2026-07-10",
    venue: "幕張メッセ 国際展示場 4～6ホール",
    sourceKind: "Animelo Summer Live 官方 DAY1 歌单",
    entries: [
      ["dawn of infinity", "dawn-of-infinity"],
      ["Secret Operation -fripSide Edition-", "secret-operation", "secret-operation-fripside-edition"],
      ["future gazer", "future-gazer"],
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
    const song = songs[songSlug];
    if (!song) throw new Error(`缺少歌曲定义：${songSlug}`);
    const version = versionSlug ? versions[versionSlug] : null;
    if (versionSlug && !version) throw new Error(`缺少版本定义：${versionSlug}`);
    rows.push([
      manifest.eventSlug,
      "fripSide出演枠",
      manifest.title,
      "complete",
      "official",
      index + 1,
      "main",
      displayTitle,
      songSlug,
      song.title,
      "",
      "",
      song.artist,
      versionSlug,
      version?.[0] ?? "",
      version?.[1] ?? "",
      version ? "fripSide" : "",
      medleyGroup,
      manifest.sourceUrl,
      `${manifest.sourceKind}；本站仅收录 fripSide 出演及合作段落。`,
      "",
      entryNotes,
    ]);
  });
}

const report = {
  generated_at: new Date().toISOString(),
  status: "ready",
  scope: "Animelo Summer Live 2025 与 2026 的 fripSide 出演及合作段落",
  methodology: [
    "活动日期、地点与类型复用本站已有 events 记录；两场均为 classification=拼盘。",
    "2025 曲序、Medley 边界和逐曲演出人员来自 Animelo Summer Live 官方歌单。",
    "2026 曲序和版本标题以 Animelo Summer Live 官方 DAY1 歌单为准，并与用户提供的 setlist.fm 页面交叉核对。",
    "合作曲目作为独立 Song 保存，现场人员写入 setlist entry notes，不创建虚构的录音版本。",
    "只有来源明确写出版本名的曲目才关联 performed_version_id。",
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
  cross_check_sources: [
    "https://www.setlist.fm/setlist/fripside/2026/makuhari-messe-kokusai-tenjijou-hall-4-5-6-chiba-japan-3373c041.html",
    "https://fripside.net/contents/1058630",
    "https://www.livefans.jp/events/1784162",
  ],
};

await mkdir(resolve("data/normalized"), { recursive: true });
await mkdir(resolve("data/reports"), { recursive: true });
await writeFile(outputCsv, `${headers.map(csvCell).join(",")}\n${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);
await writeFile(outputReport, `${JSON.stringify(report, null, 2)}\n`);

console.log(`已生成 ${outputCsv}`);
console.log(`已生成 ${outputReport}`);
console.log(`歌单 ${manifests.length} 份；曲目 ${rows.length} 条；Medley ${report.setlists.reduce((sum, item) => sum + item.medleys.length, 0)} 组。`);
