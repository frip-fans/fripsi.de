import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const earlyArchive = process.argv.includes("--early");
const researchPath = resolve(earlyArchive
  ? "data/research/livefans-fripside-phase2-early-archive.json"
  : "data/research/livefans-fripside-phase2-archive.json");
const discographyPath = resolve("data/normalized/fripside-complete-discography-tracks.csv");
const eventsSqlPath = resolve(earlyArchive
  ? "data/normalized/fripside-phase2-early-events-2014-2018.sql"
  : "data/normalized/fripside-phase2-events-2017-2022.sql");
const setlistsCsvPath = resolve(earlyArchive
  ? "data/normalized/fripside-phase2-early-setlists-2014-2018.csv"
  : "data/normalized/fripside-phase2-setlists-2017-2020.csv");
const emptyReleasesPath = resolve(earlyArchive
  ? "data/normalized/fripside-phase2-early-empty-release-tracks.csv"
  : "data/normalized/fripside-phase2-empty-release-tracks.csv");
const reportPath = resolve(earlyArchive
  ? "data/reports/fripside-phase2-early-archive-summary.json"
  : "data/reports/fripside-phase2-archive-summary.json");
const backlogPath = resolve(earlyArchive
  ? "data/research/fripside-phase2-early-setlist-manual-backlog.csv"
  : "data/research/fripside-phase2-setlist-manual-backlog.csv");
const rangeStart = earlyArchive ? "2014-01-01" : "2017-01-01";
const rangeEnd = earlyArchive ? "2018-12-31" : "2022-04-24";
const setlistRangeEnd = earlyArchive ? "2018-12-31" : "2020-12-31";

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

const existingEventSlugs = new Map(Object.entries({
  "2017-01-07": "2017-01-07-is3",
  "2017-01-14": "2017-01-14-animax-musix",
  "2017-01-21": "2017-01-21-is3",
  "2017-02-19": "2017-02-19-is3",
  "2017-02-26": "2017-02-26-is3",
  "2017-03-05": "2017-03-05-is3",
  "2017-03-18": "2017-03-18-fripside-live-tour-2016-2017-final-in-saitama-super-arena-run-for-the-15th-anniversary-supported-by-animelo-mix",
  "2017-08-26": "2017-08-26-animelo-summer-live-2017-the-card",
  "2017-11-18": "2017-11-18-crossroads",
  "2017-11-23": "2017-11-23-animax-musix",
  "2017-11-26": "2017-11-26-c3afa-singapore",
  "2017-12-02": "2017-12-02-crossroads",
  "2017-12-03": "2017-12-03-crossroads",
  "2017-12-08": "2017-12-08-crossroads",
  "2017-12-16": "2017-12-16-crossroads",
  "2017-12-28": "2017-12-28-countdown-japan",
  "2018-01-07": "2018-01-07-crossroads",
  "2018-01-08": "2018-01-08-crossroads",
  "2018-01-28": "2018-01-28-lisani-live",
  "2018-02-03": "2018-02-03-nbcuniversal-25th",
  "2018-04-21": "2018-04-21-animax-musix",
  "2018-07-15": "2018-07-15-join-alive",
  "2018-09-17": "2018-09-17-dempagumi-vs-fripside",
  "2018-12-24": "2018-12-24-is4",
  "2018-12-28": "2018-12-28-countdown-japan",
  "2019-11-04": "2019-11-04-fripside-phase-2-10th-anniversary-tour-2019-2020-infinite-synthesis-5",
  "2019-11-17": "2019-11-17-fripside-phase-2-10th-anniversary-tour-2019-2020-infinite-synthesis-5",
  "2019-12-21": "2019-12-21-fripside-phase-2-10th-anniversary-tour-2019-2020-infinite-synthesis-5",
  "2020-01-11": "2020-01-11-fripside-phase-2-10th-anniversary-tour-2019-2020-infinite-synthesis-5",
  "2020-01-13": "2020-01-13-fripside-phase-2-10th-anniversary-tour-2019-2020-infinite-synthesis-5",
  "2020-01-24": "2020-01-24-fripside-phase-2-10th-anniversary-tour-2019-2020-infinite-synthesis-5",
  "2020-02-02": "2020-02-02-fripside-phase-2-10th-anniversary-tour-2019-2020-infinite-synthesis-5",
  "2020-02-08": "2020-02-08-live-2022-saturday-stage",
  "2020-02-23": "2020-02-23-fripside-phase-2-10th-anniversary-tour-2019-2020-infinite-synthesis-5",
  "2021-01-03": "2021-01-03-fripside-phase-2-10th-anniversary-tour-2019-2020-infinite-synthesis-5-re",
  "2021-02-11": "2021-02-11-fripside-phase2-10th-anniversary-final-in-yokohama-arena",
  "2022-04-02": "2022-04-02-fripside-phase2-final-arena-tour-2022-infinite-synthesis-endless-voyage",
  "2022-04-09": "2022-04-02-fripside-phase2-final-arena-tour-2022-infinite-synthesis-endless-voyage-2f7333",
  "2022-04-23": "2022-04-23-fripside-phase2-final-arena-tour-2022-infinite-synthesis-endless-voyage",
  "2022-04-24": "2022-04-24-fripside-phase2-final-arena-tour-2022-infinite-synthesis-endless-voyage",
}));

const officialSources = [
  { test: (source) => /infinite synthesis 2/i.test(source.tour), url: "https://nbcuni-music.com/fripside/liveinfo/news/hp0001/index00020000.html" },
  { test: (source) => /infinite synchronicity/i.test(source.tour), url: "https://nbcuni-music.com/fripside/liveinfo/contents/hp0001/index00030000.html" },
  { test: (source) => /infinite synthesis 3/i.test(source.tour), url: "https://nbcuni-music.com/fripside/news/hp0001/index03340000.html" },
  { test: (source) => source.eventId === "698620", url: "https://nbcuni-music.com/fripside/liveinfo/contents/hp0001/index00060000.html" },
  { test: (source) => /crossroads/i.test(source.tour), url: "https://nbcuni-music.com/fripside/liveinfo/contents/hp0001/index00070000.html" },
  { test: (source) => /infinite synthesis 4/i.test(source.tour), url: "https://fripside.net/contents/521703" },
  { test: (source) => /infinite synthesis5/i.test(source.tour), url: "https://fripside.net/contents/521716" },
  { test: (source) => /\[Re:\]/i.test(source.tour), url: "https://nbcuni-music.com/fripside/liveinfo/contents/hp0001/index00130000.html" },
  { test: (source) => source.eventId === "1288503", url: "https://nbcuni-music.com/fripside/liveinfo/contents/hp0001/index00140000.html" },
  { test: (source) => /Final Arena Tour 2022/i.test(source.tour), url: "https://nbcuni-music.com/fripside/liveinfo/contents/hp0001/index00110000.html" },
];

const laterSupplementalSources = [
  {
    eventId: "official-animax-2017-osaka",
    date: "2017-01-14",
    startTime: "14:00",
    title: "ANIMAX MUSIX 2017 OSAKA",
    tour: "ANIMAX MUSIX 2017 OSAKA",
    venue: "大阪城ホール",
    region: "大阪",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://www.animax.co.jp/animaxmusix/archive/archive_2017_osaka.html",
    sourceKind: "official-event-archive",
    confidence: "official",
    tracks: [
      ["Two souls –toward the truth-"],
      ["The end of escape -fripSide only ver.-"],
      ["magicaride -version2016-"],
      ["only my railgun"],
      ["mind as Judgment", { originalArtist: "飛蘭", artistCredit: "fripSide" }],
    ],
  },
  {
    eventId: "setlistfm-animelo-2017",
    date: "2017-08-26",
    startTime: "16:00",
    title: "Animelo Summer Live 2017 -THE CARD-",
    tour: "Animelo Summer Live 2017 -THE CARD-",
    venue: "さいたまスーパーアリーナ",
    region: "埼玉",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://www.setlist.fm/setlist/fripside/2017/saitama-super-arena-saitama-japan-135931a9.html",
    sourceKind: "setlistfm-user-submission",
    confidence: "reported",
    tracks: [["black bullet"], ["The end of escape"], ["clockwork planet"], ["only my railgun"]],
  },
  {
    eventId: "official-animax-2017-yokohama",
    date: "2017-11-23",
    startTime: "14:00",
    title: "ANIMAX MUSIX 2017 YOKOHAMA",
    tour: "ANIMAX MUSIX 2017 YOKOHAMA",
    venue: "横浜アリーナ",
    region: "神奈川",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://www.animax.co.jp/animaxmusix/archive/archive_2017_yokohama.html",
    sourceKind: "official-event-archive",
    confidence: "official",
    tracks: [
      ["only my railgun", { medleyGroup: "animax-2017-yokohama-medley" }],
      ["sister's noise", { medleyGroup: "animax-2017-yokohama-medley" }],
      ["clockwork planet"],
      ["black bullet"],
      ["Two souls –toward the truth-"],
      ["TESTAMENT", { originalArtist: "水樹奈々", artistCredit: "fripSide × 三森すずこ" }],
    ],
  },
  {
    eventId: "official-c3afa-singapore-2017",
    date: "2017-11-26",
    startTime: "",
    title: "C3AFA Singapore 2017",
    tour: "C3AFA Singapore 2017",
    venue: "Suntec Singapore Convention & Exhibition Centre",
    region: "Singapore",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://fripside.net/contents/521687",
    sourceKind: "official-event-announcement",
    confidence: "official",
    tracks: [],
  },
  {
    eventId: "official-animax-guangzhou-2018",
    date: "2018-04-21",
    startTime: "",
    title: "ANIMAX MUSIX 2018 Guangzhou",
    tour: "ANIMAX MUSIX 2018 Guangzhou",
    venue: "広州体育館 第一体育館",
    region: "広州",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://www.ptt.cc/bbs/LoveLive_Sip/M.1524325741.A.D2E.html",
    eventSourceUrl: "https://fripside.net/contents/521682",
    sourceKind: "audience-report",
    confidence: "reported",
    tracks: [
      ["sister's noise"],
      ["Burst The Gravity", { originalArtist: "ALTIMA", artistCredit: "fripSide" }],
      ["killing bites"],
      ["black bullet"],
      ["only my railgun"],
    ],
  },
  {
    eventId: "official-animax-2019-yokohama",
    date: "2019-11-23",
    startTime: "14:00",
    title: "ANIMAX MUSIX 2019 YOKOHAMA",
    tour: "ANIMAX MUSIX 2019 YOKOHAMA",
    venue: "横浜アリーナ",
    region: "神奈川",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://www.animax.co.jp/animaxmusix/archive/archive_2019_yokohama.html",
    sourceKind: "official-event-archive",
    confidence: "official",
    tracks: [
      ["Love with You"],
      ["BLACKFOX"],
      ["sister's noise", { medleyGroup: "animax-2019-yokohama-medley" }],
      ["future gazer", { medleyGroup: "animax-2019-yokohama-medley" }],
      ["eternal reality", { medleyGroup: "animax-2019-yokohama-medley" }],
      ["way to answer", { medleyGroup: "animax-2019-yokohama-medley" }],
      ["LEVEL5-judgelight-", { medleyGroup: "animax-2019-yokohama-medley" }],
      ["only my railgun", { medleyGroup: "animax-2019-yokohama-medley" }],
      ["恋はスリル、ショック、サスペンス", { originalArtist: "愛内里菜", artistCredit: "fripSide" }],
    ],
  },
].map((source) => ({
  ...source,
  tracks: source.tracks.map(([title, options = {}], index) => ({
    position: index + 1,
    title,
    memo: "",
    artistCredit: options.artistCredit ?? "fripSide",
    sectionNote: "",
    originalArtist: options.originalArtist,
    medleyGroup: options.medleyGroup,
  })),
}));

function supplement(source) {
  return {
    completeness: "complete",
    ...source,
    tracks: source.tracks.map(([title, options = {}], index) => ({
      position: index + 1,
      title,
      memo: options.memo ?? "",
      artistCredit: options.artistCredit ?? "fripSide",
      sectionNote: "",
      section: options.section ?? "main",
      originalArtist: options.originalArtist,
      medleyGroup: options.medleyGroup,
      entryNote: options.entryNote,
    })),
  };
}

const earlySupplementalSources = [
  supplement({
    eventId: "official-animelo-2014",
    replaceEventId: "273745",
    date: "2014-08-29",
    startTime: "16:00",
    title: "Animelo Summer Live 2014 -ONENESS-",
    tour: "Animelo Summer Live 2014 -ONENESS-",
    venue: "さいたまスーパーアリーナ",
    region: "埼玉",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://anisama.tv/2014/",
    sourceKind: "official-event-archive",
    confidence: "official",
    tracks: [["sister's noise"], ["black bullet"], ["only my railgun"]],
  }),
  supplement({
    eventId: "official-afa-singapore-2014",
    date: "2014-12-06",
    startTime: "",
    title: "Anime Festival Asia Singapore 2014",
    tour: "Anime Festival Asia Singapore 2014",
    venue: "Suntec Singapore Convention & Exhibition Centre",
    region: "Singapore",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://www.lisani.jp/0000001454/",
    eventSourceUrl: "https://animefestival.asia/afa2014/wp-content/uploads/2014/10/Media-Release-Star-studded-Anime-Festival-Asia-2014-with-new-anisong-artists-and-niconico-28-Sep-2014.pdf",
    sourceKind: "editorial-report",
    confidence: "reported",
    completeness: "partial",
    tracks: [["only my railgun"], ["black bullet"], ["sister's noise"]],
  }),
  supplement({
    eventId: "reported-lisani-live-5",
    replaceEventId: "402617",
    date: "2015-01-25",
    startTime: "18:40",
    title: "リスアニ！LIVE-5",
    tour: "リスアニ！LIVE-5",
    venue: "日本武道館",
    region: "東京",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://www.air-be.net/special/20150124_lisani_live5/",
    sourceKind: "editorial-report",
    confidence: "reported",
    tracks: [
      ["black bullet"],
      ["Heaven is a Place on Earth"],
      ["everlasting"],
      ["Rising Hope -TV ver.-", { originalArtist: "LiSA", artistCredit: "fripSide feat. KOTOKO" }],
      ["LEVEL5-judgelight-", { medleyGroup: "lisani-live-5-medley" }],
      ["future gazer", { medleyGroup: "lisani-live-5-medley" }],
      ["eternal reality", { medleyGroup: "lisani-live-5-medley" }],
      ["only my railgun", { medleyGroup: "lisani-live-5-medley" }],
      ["sister's noise"],
    ],
  }),
  supplement({
    eventId: "official-is2-final-yokohama",
    replaceEventId: "377728",
    date: "2015-03-01",
    startTime: "17:00",
    title: "fripSide LIVE TOUR 2014-2015 FINAL in YOKOHAMA ARENA",
    tour: "fripSide LIVE TOUR 2014-2015 FINAL in YOKOHAMA ARENA",
    venue: "横浜アリーナ",
    region: "神奈川",
    artists: ["fripSide"],
    sourceUrl: "https://fripside.net/musics/11751",
    eventSourceUrl: "https://nbcuni-music.com/fripside/liveinfo/news/hp0001/index00020000.html",
    sourceKind: "official-video-tracklist",
    confidence: "official",
    tracks: [
      ["fermata~Akkord:fortissimo~"],
      ["pico scope -SACLA-"],
      ["scorching heart"],
      ["I'm believing you"],
      ["Secret of my heart"],
      ["lost dimension"],
      ["rain of tears"],
      ["black bullet"],
      ["fortissimo -from insanity affection-"],
      ["late in autumn"],
      ["endless memory ~refrain as Da Capo~"],
      ["everlasting"],
      ["future gazer"],
      ["eternal reality"],
      ["Burst The Gravity", { originalArtist: "ALTIMA", artistCredit: "ALTIMA" }],
      ["the chaostic world", { originalArtist: "ALTIMA", artistCredit: "ALTIMA" }],
      ["CYBER CYBER", { originalArtist: "ALTIMA", artistCredit: "ALTIMA" }],
      ["before dawn daybreak", { artistCredit: "fripSide + ALTIMA" }],
      ["Red -reduction division-"],
      ["come to mind (version3)"],
      ["whitebird"],
      ["last fortune"],
      ["Hesitation Snow"],
      ["fortuna on the Sixteenth night"],
      ["a silent voice"],
      ["Heaven is a Place on Earth"],
      ["trusty snow"],
      ["infinite synthesis"],
      ["sister's noise"],
      ["way to answer", { section: "encore" }],
      ["LEVEL5-judgelight-", { section: "encore" }],
      ["only my railgun", { section: "double_encore" }],
    ],
  }),
  supplement({
    eventId: "reported-afa-thailand-2015",
    date: "2015-05-02",
    startTime: "",
    title: "Anime Festival Asia Thailand 2015",
    tour: "Anime Festival Asia Thailand 2015",
    venue: "Bangkok International Trade & Exhibition Centre",
    region: "Bangkok",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://www.setlist.fm/setlist/fripside/2015/bangkok-international-trade-and-exhibition-centre-bangkok-thailand-1bae597c.html",
    eventSourceUrl: "https://animefestival.asia/",
    sourceKind: "setlistfm-user-submission",
    confidence: "reported",
    tracks: [
      ["only my railgun"], ["LEVEL5-judgelight-"], ["future gazer"],
      ["Heaven is a Place on Earth"], ["black bullet"], ["way to answer"], ["sister's noise"],
    ],
  }),
  supplement({
    eventId: "reported-anison-dream-stage-hong-kong-2015",
    date: "2015-07-26",
    startTime: "19:30",
    title: "Anison Dream Stage 2015",
    tour: "Anison Dream Stage 2015",
    venue: "KITEC Rotunda 3",
    region: "Hong Kong",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://www.pttweb.cc/bbs/LoveLive_Sip/M.1437920993.A.5B0",
    eventSourceUrl: "https://fripside.net/contents/521659",
    sourceKind: "audience-report",
    confidence: "reported",
    tracks: [
      ["only my railgun"], ["LEVEL5-judgelight-"], ["Luminize"], ["future gazer"],
      ["eternal reality"], ["black bullet"], ["way to answer"], ["sister's noise"],
    ],
  }),
  supplement({
    eventId: "reported-taiwan-2015",
    date: "2015-08-08",
    startTime: "18:30",
    title: "fripSide Live in Taiwan 2015",
    tour: "fripSide Live in Taiwan 2015",
    venue: "ATT SHOW BOX",
    region: "Taipei",
    artists: ["fripSide"],
    sourceUrl: "https://disp.cc/ptt/C_Chat/1Lnb4c5l",
    eventSourceUrl: "https://fripside.net/contents/521658",
    sourceKind: "audience-report",
    confidence: "reported",
    tracks: [
      ["future gazer"], ["Luminize"], ["Secret of my heart"],
      ["悲しい星座", { entryNote: "acoustic" }],
      ["Heaven is a Place on Earth"], ["late in autumn"], ["rain of tears"], ["black bullet"],
      ["everlasting", { entryNote: "acoustic" }],
      ["whitebird"], ["fortissimo -from insanity affection-"], ["endless memory ~refrain as Da Capo~"],
      ["way to answer"], ["LEVEL5-judgelight-"], ["infinite synthesis"],
      ["only my railgun", { section: "encore" }], ["sister's noise", { section: "encore" }],
    ],
  }),
  supplement({
    eventId: "reported-afa-indonesia-2015",
    date: "2015-09-26",
    startTime: "",
    title: "Anime Festival Asia Indonesia 2015",
    tour: "Anime Festival Asia Indonesia 2015",
    venue: "Jakarta International Expo",
    region: "Jakarta",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://nipponclub.net/2015/09/29/liputan-afaid-2015-day-2-yang-super-heboh/amp/",
    eventSourceUrl: "https://animefestival.asia/afaid15/project/featured-artiste-fripside/",
    sourceKind: "editorial-report",
    confidence: "reported",
    tracks: [
      ["only my railgun"], ["LEVEL5-judgelight-"], ["eternal reality"],
      ["fortissimo -from insanity affection-"], ["way to answer"], ["future gazer"],
      ["rain of tears"], ["black bullet"], ["sister's noise"],
    ],
  }),
  supplement({
    eventId: "reported-animax-2016-osaka",
    replaceEventId: "506921",
    date: "2016-02-13",
    startTime: "15:00",
    title: "ANIMAX MUSIX 2016 OSAKA",
    tour: "ANIMAX MUSIX 2016 OSAKA",
    venue: "グランキューブ大阪 メインホール",
    region: "大阪",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://anifesdb.net/live/ANIMAX%20MUSIX/2016-2-13/",
    eventSourceUrl: "https://www.animax.co.jp/animaxmusix/archive/archive_2016_osaka.html",
    sourceKind: "setlist-database",
    confidence: "reported",
    tracks: [
      ["Shining Star-☆-LOVE Letter", { originalArtist: "井口裕香" }],
      ["Two souls -toward the truth-"],
      ["Luminize"],
      ["white forces"],
      ["sister's noise"],
    ],
  }),
  supplement({
    eventId: "official-schwarzesmarken-fest-2016-day",
    replaceEventId: "648344",
    date: "2016-06-18",
    startTime: "15:30",
    title: "シュヴァルツェスマーケン フェスト2016 昼公演",
    tour: "シュヴァルツェスマーケン フェスト2016 昼公演",
    venue: "舞浜アンフィシアター",
    region: "千葉",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://schwarzesmarken-anime.jp/event/20160618.php",
    sourceKind: "official-event-page",
    confidence: "official",
    dayLabel: "Day 1",
    tracks: [["white forces"], ["white relation"]],
  }),
  supplement({
    eventId: "official-schwarzesmarken-fest-2016-night",
    replaceEventId: "648345",
    date: "2016-06-18",
    startTime: "19:00",
    title: "シュヴァルツェスマーケン フェスト2016 夜公演",
    tour: "シュヴァルツェスマーケン フェスト2016 夜公演",
    venue: "舞浜アンフィシアター",
    region: "千葉",
    artists: ["fripSide", "various artists"],
    sourceUrl: "https://schwarzesmarken-anime.jp/event/20160618.php",
    sourceKind: "official-event-page",
    confidence: "official",
    dayLabel: "Day 2",
    tracks: [["white forces"], ["white relation"]],
  }),
  supplement({
    eventId: "official-animecon-netherlands-2016",
    date: "2016-06-11",
    startTime: "20:00",
    title: "AnimeCon 2016",
    tour: "AnimeCon 2016",
    venue: "World Forum",
    region: "The Hague",
    artists: ["fripSide"],
    sourceUrl: "https://nbcuni-music.com/fripside/news/list00010027.html",
    eventSourceUrl: "https://animecon.nl/nl/over-ons",
    sourceKind: "official-event-announcement",
    confidence: "official",
    tracks: [],
  }),
];

const supplementalSources = [...earlySupplementalSources, ...laterSupplementalSources];

const suspiciousEventIds = new Set(["861176"]);

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

function objectRows(text) {
  const [headers, ...rows] = parseCsv(text);
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""])));
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
    .replace(/\s*[-(]?\s*(?:version|ver\.?)\s*[- ]*\d{4}\s*[-)]?\s*$/i, "")
    .replace(/\s*[-(]?\s*(?:IS\d|crossroads)\s+version\s*[-)]?\s*$/i, "")
    .replace(/\s*-?\s*fripSide\s+(?:only\s+ver\.?|edition)\s*-?\s*$/i, "")
    .trim();
}

function slugify(value) {
  const slug = normalize(stripVersion(value))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || stableId(value, "live-only").replaceAll("_", "-");
}

function stableId(value, prefix) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function sql(value) {
  if (value == null || value === "") return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function regionForVenue(venue) {
  const mappings = [
    [/名古屋|一宮|Aichi Sky Expo|愛知県国際展示場|Electric Lady Land|Diamond Hall/, "愛知"],
    [/大阪|オリックス|なんば/, "大阪"], [/倉敷/, "岡山"], [/南相馬/, "福島"], [/新潟/, "新潟"],
    [/本多の森|金沢/, "石川"], [/さいたま|埼玉/, "埼玉"], [/札幌|ニトリ|わくわく|道新|北ガス|いわみざわ|JOIN ALIVE/, "北海道"],
    [/横浜|パシフィコ|神奈川県民/, "神奈川"], [/幕張|舞浜|市原/, "千葉"], [/福岡|北九州|都久志|FUKUOKA/, "福岡"],
    [/仙台|イズミティ/, "宮城"], [/平安神宮/, "京都"], [/府中|日本武道館/, "東京"],
    [/盛岡/, "岩手"], [/キッセイ|松本/, "長野"], [/上野学園|NTTクレド/, "広島"],
    [/ナガシマ/, "三重"],
    [/神戸|ワールド記念/, "兵庫"], [/武道館/, "東京"], [/高松/, "香川"], [/仙台/, "宮城"],
    [/広州/, "広州"], [/Suntec|Singapore/, "Singapore"],
    [/Bangkok|BITEC/, "Bangkok"], [/KITEC|Hong Kong/, "Hong Kong"], [/ATT SHOW BOX|Taipei/, "Taipei"],
    [/Jakarta/, "Jakarta"], [/World Forum|The Hague/, "The Hague"],
  ];
  return mappings.find(([pattern]) => pattern.test(venue))?.[1] ?? "";
}

function isMixedEvent(source) {
  return new Set(source.artists ?? []).size > 1
    || /ANIMAX|Animelo Summer|リスアニ|COUNTDOWN JAPAN|JOIN ALIVE|NBCUniversal|C3AFA|でんぱ組|Anime Festival Asia|Anison Dream Stage|ナゴヤアニソン|シュヴァルツェスマーケン|ニコニコ超会議|超音楽祭|平安神宮奉納/i.test(`${source.title} ${source.tour}`);
}

function eventSlug(source) {
  if (existingEventSlugs.has(source.date)) return existingEventSlugs.get(source.date);
  const tag = (() => {
    const value = `${source.title} ${source.tour}`;
    if (/infinite synthesis 2/i.test(value)) return "is2";
    if (/infinite synchronicity/i.test(value)) return "infinite-synchronicity";
    if (/infinite synthesis 3/i.test(value)) return "is3";
    if (/crossroads/i.test(value)) return "crossroads";
    if (/infinite synthesis 4/i.test(value)) return "is4";
    if (/infinite synthesis5/i.test(value)) return "is5";
    if (/ANIMAX/i.test(value)) return "animax-musix";
    if (/COUNTDOWN/i.test(value)) return "countdown-japan";
    if (/JOIN ALIVE/i.test(value)) return "join-alive";
    if (/NBCUniversal/i.test(value)) return "nbcuniversal-25th";
    if (/リスアニ/i.test(value)) return "lisani-live";
    if (/でんぱ組/i.test(value)) return "dempagumi-vs-fripside";
    if (/C3AFA/i.test(value)) return "c3afa-singapore";
    if (/Anime Festival Asia/i.test(value)) return "anime-festival-asia";
    if (/Anison Dream Stage/i.test(value)) return "anison-dream-stage";
    if (/AnimeCon/i.test(value)) return "animecon";
    return `fripside-live-${source.eventId}`;
  })();
  return `${source.date}-${tag}`;
}

function shortVenue(venue) {
  const mappings = [
    [/なんばHatch/, "なんばHatch"], [/仙台CLUB JUNK BOX/, "仙台CLUB JUNK BOX"],
    [/PENNY LANE 24/, "PENNY LANE 24"], [/Electric Lady Land/, "Electric Lady Land"],
    [/FUKUOKA BEAT STATION/, "BEAT STATION"], [/舞浜アンフィシアター/, "舞浜アンフィシアター"],
    [/Diamond Hall/, "Diamond Hall"], [/都久志会館/, "都久志会館"],
    [/神奈川県民ホール/, "神奈川県民ホール"], [/イズミティ21/, "イズミティ21"],
    [/道新ホール/, "道新ホール"], [/NTTクレドホール/, "NTTクレドホール"],
    [/府中の森/, "府中の森"], [/北ガス文化ホール/, "北ガス文化ホール"],
    [/キッセイ文化ホール/, "キッセイ文化ホール"], [/上野学園ホール/, "上野学園ホール"],
    [/盛岡市民文化ホール/, "盛岡市民文化ホール"], [/福岡国際会議場/, "福岡国際会議場"],
    [/ナガシマスパーランド/, "ナガシマ"], [/World Forum/, "World Forum"],
    [/Bangkok International/, "BITEC"], [/KITEC/, "KITEC"], [/ATT SHOW BOX/, "ATT SHOW BOX"],
    [/Jakarta International/, "JIExpo"], [/Suntec/, "Suntec"],
    [/名古屋国際会議場/, "名古屋国際会議場"], [/倉敷市民会館/, "倉敷市民会館"],
    [/南相馬/, "南相馬ゆめはっと"], [/新潟県民会館/, "新潟県民会館"], [/本多の森/, "本多の森ホール"],
    [/さいたまスーパーアリーナ/, "さいたまスーパーアリーナ"], [/ニトリ/, "ニトリ文化ホール"],
    [/幕張メッセ/, "幕張メッセ"], [/福岡サンパレス/, "福岡サンパレス"],
    [/ワールド記念/, "神戸ワールド記念ホール"], [/横浜アリーナ/, "横浜アリーナ"],
    [/大阪城/, "大阪城ホール"], [/日本武道館/, "日本武道館"], [/JOIN ALIVE/, "いわみざわ公園"],
    [/Zepp Sapporo/, "Zepp Sapporo"], [/わくわく/, "わくわくホリデーホール"],
    [/グランキューブ/, "グランキューブ大阪"], [/福岡市民会館/, "福岡市民会館"],
    [/一宮市民会館/, "一宮市民会館"], [/パシフィコ横浜/, "パシフィコ横浜"],
    [/神戸国際会館/, "神戸国際会館"], [/サンポート/, "サンポート高松"],
    [/北九州ソレイユ/, "北九州ソレイユホール"], [/金沢歌劇座/, "金沢歌劇座"],
    [/名古屋市公会堂/, "名古屋市公会堂"], [/札幌市教育文化会館/, "札幌市教育文化会館"],
    [/仙台サンプラザ/, "仙台サンプラザ"], [/広州体育館/, "広州体育館"],
  ];
  return mappings.find(([pattern]) => pattern.test(venue))?.[1] ?? venue;
}

function conciseSetlistTitle(source) {
  const venue = shortVenue(source.venue);
  const value = `${source.title} ${source.tour}`;
  if (/LIVE TOUR 2014-2015 FINAL/i.test(value)) return `IS2 Final · ${venue}`;
  if (/infinite synthesis 2/i.test(value) && /FINAL/i.test(value)) return `IS2 Final · ${venue}`;
  if (/infinite synthesis 2/i.test(value)) return `IS2 · ${venue}`;
  if (/infinite synchronicity/i.test(value)) return `synchronicity · ${venue}`;
  if (/infinite synthesis 3/i.test(value)) return `IS3 · ${venue}`;
  if (/Run for the 15th Anniversary/i.test(value)) return `15th Final · ${venue}`;
  if (/crossroads/i.test(value)) {
    const day = source.date === "2017-12-02" || source.date === "2018-01-07" ? " Day 1"
      : source.date === "2017-12-03" || source.date === "2018-01-08" ? " Day 2" : "";
    return `crossroads · ${venue}${day}`;
  }
  if (/infinite synthesis 4/i.test(value)) {
    const day = source.date === "2019-03-08" ? " Day 1" : source.date === "2019-03-09" ? " Day 2" : "";
    return `IS4 · ${venue}${day}`;
  }
  if (/infinite synthesis5/i.test(value)) return `IS5 · ${venue}`;
  if (/ANIMAX.*2017.*OSAKA/i.test(value)) return `ANIMAX 2017 Osaka · ${venue}`;
  if (/ANIMAX.*2017.*YOKOHAMA/i.test(value)) return `ANIMAX 2017 Yokohama · ${venue}`;
  if (/Animelo Summer Live 2017/i.test(value)) return `Animelo 2017 · ${venue}`;
  if (/ANIMAX.*2018.*Guangzhou/i.test(value)) return `ANIMAX 2018 Guangzhou · ${venue}`;
  if (/ANIMAX.*2019.*OSAKA/i.test(value)) return `ANIMAX 2019 Osaka · ${venue}`;
  if (/ANIMAX.*2019.*YOKOHAMA/i.test(value)) return `ANIMAX 2019 Yokohama · ${venue}`;
  if (/リスアニ.*2018/i.test(value)) return `リスアニ！LIVE 2018 · ${venue}`;
  if (/リスアニ.*2020/i.test(value)) return `リスアニ！LIVE 2020 · ${venue}`;
  if (/NBCUniversal/i.test(value)) return `NBCU 25th · ${venue}`;
  if (/JOIN ALIVE 2016/i.test(value)) return `JOIN ALIVE 2016 · いわみざわ公園`;
  if (/JOIN ALIVE/i.test(value)) return `JOIN ALIVE 2018 · ${venue}`;
  if (/でんぱ組/i.test(value)) return `でんぱ組.inc × fripSide · ${venue}`;
  if (/COUNTDOWN JAPAN ([^\s]+)/i.test(value)) return `COUNTDOWN JAPAN ${value.match(/COUNTDOWN JAPAN ([^\s]+)/i)[1]} · ${venue}`;
  if (/COUNT DOWN LIVE SHOW 2014/i.test(value)) return `COUNT DOWN 2014→2015 · ${venue}`;
  if (/COUNT DOWN LIVE 2015/i.test(value)) return `COUNT DOWN 2015→2016 · ${venue}`;
  if (/リスアニ.*LIVE-?4/i.test(value)) return `LisAni 4 · ${venue}`;
  if (/リスアニ.*LIVE-?5/i.test(value)) return `LisAni 5 · ${venue}`;
  if (/リスアニ.*2016/i.test(value)) return `LisAni 2016 · ${venue}`;
  if (/ニコニコ超会議3/i.test(value)) return `Niconico Chokaigi 3 · ${venue}`;
  if (/Animelo Summer Live 2014/i.test(value)) return `Animelo 2014 · SSA`;
  if (/平安神宮/i.test(value)) return `Heian Jingu 2014 · 平安神宮`;
  if (/Anime Festival Asia Singapore 2014/i.test(value)) return `AFA SG 2014 · ${venue}`;
  if (/ANIMAX.*2015.*OSAKA/i.test(value)) return `ANIMAX 2015 Osaka · ${venue}`;
  if (/Anime Festival Asia Thailand 2015/i.test(value)) return `AFA Thailand 2015 · ${venue}`;
  if (/Anison Dream Stage/i.test(value)) return `Anison Dream Stage · ${venue}`;
  if (/Live in Taiwan 2015/i.test(value)) return `Taiwan 2015 · ${venue}`;
  if (/Anime Festival Asia Indonesia 2015/i.test(value)) return `AFA ID 2015 · ${venue}`;
  if (/ANIMAX.*2016.*OSAKA/i.test(value)) return `ANIMAX 2016 Osaka · ${venue}`;
  if (/ナゴヤアニソンフェス2016/i.test(value)) return `Nagoya Anison 2016 · ${venue}`;
  if (/シュヴァルツェスマーケン/i.test(value)) return `Schwarzes Fest · 舞浜 ${source.dayLabel ?? ""}`.trim();
  if (/COUNTDOWN JAPAN 16\/17/i.test(value)) return `COUNTDOWN JAPAN 16/17 · ${venue}`;
  return `${source.title} · ${venue}`;
}

function sourceTracks(source) {
  let tracks = source.tracks ?? [];
  const hasMultiArtistRoster = new Set((source.artists ?? []).map((artist) => artist.trim()).filter(Boolean)).size > 1;
  if (hasMultiArtistRoster && /^\d+$/.test(source.eventId)) {
    tracks = tracks.filter((track) => /fripSide/i.test(track.artistCredit) && !/出演者全員/.test(track.artistCredit));
  }
  return tracks.filter((track) => !/^(?:バンドソロ|MC|トーク|メンバー紹介)$/i.test(track.title.trim())).map((track) => {
    if (/^divine crimimal$/i.test(track.title)) return { ...track, title: "divine criminal" };
    if (/^My Own way$/i.test(track.title)) return { ...track, title: "My Own Way" };
    if (/^Shooting Star\s*\[KOTOKO\]$/i.test(track.title)) {
      return { ...track, title: "Shooting Star", originalArtist: "KOTOKO", artistCredit: "fripSide" };
    }
    return track;
  });
}

const [research, discographyText] = await Promise.all([
  readFile(researchPath, "utf8").then(JSON.parse),
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

const songAliases = new Map([
  ["red reduction division", "red-reduction-division"],
  ["two souls toward the truth", "two-souls-toward-the-truth"],
  ["sisters noise", "sisters-noise"],
  ["level5 judgelight", "level5-judgelight"],
]);

const knownLiveOnlySongs = new Map([
  ["mind as judgment", { slug: "mind-as-judgment", title: "mind as Judgment", originalArtist: "飛蘭" }],
  ["unfinished", { slug: "unfinished", title: "→unfinished→", originalArtist: "KOTOKO" }],
  ["shoot", { slug: "shoot", title: "SHOOT!", originalArtist: "RO-KYU-BU!" }],
  ["あっせんぶる love さんぶる", { slug: "assemble-love-samble", title: "あっせんぶる☆LOVE さんぶる", originalArtist: "fripSide NAO project!" }],
  ["testament", { slug: "testament", title: "TESTAMENT", originalArtist: "水樹奈々" }],
  ["burst the gravity", { slug: "burst-the-gravity", title: "Burst The Gravity", originalArtist: "ALTIMA" }],
  ["invoke", { slug: "invoke", title: "INVOKE", originalArtist: "T.M.Revolution" }],
  ["恋はスリル ショック サスペンス", { slug: "koi-wa-thrill-shock-suspense", title: "恋はスリル、ショック、サスペンス", originalArtist: "愛内里菜" }],
  ["rising hope tv ver", { slug: "rising-hope", title: "Rising Hope", originalArtist: "LiSA" }],
  ["shining star love letter", { slug: "shining-star-love-letter", title: "Shining Star-☆-LOVE Letter", originalArtist: "井口裕香" }],
  ["shooting star", { slug: "shooting-star-kotoko", title: "Shooting Star", originalArtist: "KOTOKO" }],
  ["the chaostic world", { slug: "the-chaostic-world", title: "the chaostic world", originalArtist: "ALTIMA" }],
  ["cyber cyber", { slug: "cyber-cyber", title: "CYBER CYBER", originalArtist: "ALTIMA" }],
]);

function findSongAndVersion(track) {
  const displayTitle = track.title.trim();
  const exactVersions = [...(versionsByName.get(normalize(displayTitle))?.values() ?? [])]
    .filter((version) => !/instrumental/i.test(`${version.title} ${version.label}`));
  let version = exactVersions.length === 1 ? exactVersions[0] : null;
  const baseTitle = stripVersion(displayTitle);
  let song = version ? songsBySlug.get(version.songSlug) : songsByName.get(normalize(baseTitle));
  if (!song && songAliases.has(normalize(baseTitle))) song = songsBySlug.get(songAliases.get(normalize(baseTitle)));
  if (!song && knownLiveOnlySongs.has(normalize(baseTitle))) {
    song = { ...knownLiveOnlySongs.get(normalize(baseTitle)), firstReleaseDate: "", liveOnly: true };
  }
  if (!song) {
    song = {
      slug: slugify(baseTitle),
      title: baseTitle,
      firstReleaseDate: "",
      originalArtist: track.originalArtist || track.artistCredit || "fripSide",
      liveOnly: true,
    };
  }
  if (!version) {
    const candidates = [...(versionsBySong.get(song.slug)?.values() ?? [])]
      .filter((candidate) => !/instrumental/i.test(`${candidate.title} ${candidate.label}`));
    if (candidates.length === 1) version = candidates[0];
  }
  return { song, version, displayTitle };
}

const rawSources = research.events.filter((source) =>
  !suspiciousEventIds.has(source.eventId)
  && source.date >= rangeStart
  && source.date <= rangeEnd);
const supplementalByDate = new Map(supplementalSources.map((source) => [source.date, source]));
const sources = [
  ...rawSources.filter((source) => !supplementalByDate.has(source.date)),
  ...supplementalSources.filter((source) => source.date >= rangeStart && source.date <= rangeEnd),
].sort((left, right) => left.date.localeCompare(right.date));

const eventRecords = sources.map((source) => {
  const region = source.region || source.prefecture || regionForVenue(source.venue);
  const name = source.tour || source.title;
  return {
    ...source,
    slug: eventSlug(source),
    region,
    classification: isMixedEvent(source) ? "拼盘" : "专场",
    eventTitle: `「${name}」@${region ? `${region}・` : ""}${source.venue}`,
  };
});

const duplicateEventSlugs = eventRecords.map((event) => event.slug).filter((slug, index, all) => all.indexOf(slug) !== index);
if (duplicateEventSlugs.length) throw new Error(`活动 slug 重复：${duplicateEventSlugs.join(", ")}`);

const now = new Date().toISOString();
// Wrangler's remote D1 bulk executor wraps uploaded files itself and rejects
// explicit BEGIN/COMMIT statements. Keep the generated file compatible with
// both local validation and remote import.
const eventStatements = ["PRAGMA foreign_keys = ON;"];
for (const event of eventRecords) {
  const id = stableId(event.slug, "evt_phase2");
  eventStatements.push(`INSERT INTO events (id, slug, title, start_date, end_date, start_time, end_time, timezone, category, classification, venue, region, remark, status, published, version, created_at, updated_at, published_at, archived_at)
VALUES (${[
    id, event.slug, event.eventTitle, event.date, null, event.startTime || null, null, "Asia/Tokyo", "LIVE",
    event.classification, event.venue, event.region || null, "fripSide Phase 2 演出归档补全。", "completed", 1, 1,
    now, now, now, null,
  ].map(sql).join(", ")})
ON CONFLICT(slug) DO UPDATE SET title = excluded.title, start_date = excluded.start_date,
  start_time = COALESCE(excluded.start_time, events.start_time), category = excluded.category,
  classification = excluded.classification, venue = excluded.venue, region = excluded.region,
  status = excluded.status, published = 1, updated_at = excluded.updated_at,
  published_at = COALESCE(events.published_at, excluded.published_at);`);

  const eventSourceUrl = event.eventSourceUrl || event.sourceUrl;
  const urls = new Set([eventSourceUrl]);
  if (/^\d+$/.test(event.eventId)) urls.add(event.sourceUrl);
  const official = officialSources.find((candidate) => candidate.test(event));
  if (official) urls.add(official.url);
  for (const url of [...urls].filter(Boolean)) {
    const officialUrl = url !== event.sourceUrl || event.sourceKind?.startsWith("official");
    eventStatements.push(`INSERT OR IGNORE INTO event_sources (id, event_id, url, label, source_type, verified_at, created_at, created_by)
VALUES (${[
      stableId(`${event.slug}|${url}`, "src_phase2"),
    ].map(sql).join(", ")}, (SELECT id FROM events WHERE slug = ${sql(event.slug)}), ${[
      url, officialUrl ? "演出官方资料" : "LiveFans 公演记录", officialUrl ? "official" : "community-archive",
      officialUrl ? now : null, now, "phase2-archive-import",
    ].map(sql).join(", ")});`);
  }
}
const setlistRows = [];
const setlistReport = [];
const newLiveOnlySongs = new Map();
for (const source of sources.filter((source) => source.date <= setlistRangeEnd)) {
  const tracks = sourceTracks(source);
  if (!tracks.length) continue;
  const event = eventRecords.find((candidate) => candidate.date === source.date && candidate.eventId === source.eventId);
  const mixed = isMixedEvent(source);
  const performanceLabel = mixed ? "fripSide出演枠" : "本公演";
  const confidence = source.confidence || "reported";
  const notes = confidence === "official"
    ? "曲序来自演出官方档案；串烧中的歌曲拆分为独立曲目，并以同一 medley 标识关联。"
    : source.sourceKind === "audience-report"
      ? "曲序来自公开观众记录，按 reported 收录。"
      : source.sourceKind === "setlistfm-user-submission"
        ? "曲序来自 setlist.fm 用户投稿，按 reported 收录。"
        : source.sourceKind === "editorial-report" || source.sourceKind === "setlist-database"
          ? "曲序来自公开演出报道或歌单资料库，按 reported 收录。"
        : "曲序来自 LiveFans 用户投稿；拼盘活动仅保留演出者标注中包含 fripSide 的曲目。";

  tracks.forEach((track, index) => {
    const { song, version, displayTitle } = findSongAndVersion(track);
    const entryNotes = [];
    if (track.memo) entryNotes.push(track.memo);
    if (track.artistCredit && !/^fripSide$/i.test(track.artistCredit)) entryNotes.push(`演出：${track.artistCredit}`);
    if (song.liveOnly) newLiveOnlySongs.set(song.slug, song);
    setlistRows.push([
      event.slug,
      performanceLabel,
      conciseSetlistTitle(source),
      source.completeness || "complete",
      confidence,
      index + 1,
      track.section || "main",
      displayTitle,
      song.slug,
      song.title,
      "",
      song.firstReleaseDate,
      song.originalArtist,
      version?.slug ?? "",
      version?.title ?? "",
      version?.label ?? "",
      version?.artistCredit || track.artistCredit || song.originalArtist || "fripSide",
      track.medleyGroup ?? "",
      source.sourceUrl,
      notes,
      song.liveOnly ? "目前仅在 Live 歌单来源中确认，尚未关联本站专辑条目。" : "",
      [track.entryNote, ...entryNotes].filter(Boolean).join("；"),
    ]);
  });
  setlistReport.push({
    date: source.date,
    event_slug: event.slug,
    title: conciseSetlistTitle(source),
    source_url: source.sourceUrl,
    confidence,
    source_track_count: source.tracks.length,
    imported_track_count: tracks.length,
  });
}

const backlog = earlyArchive ? [
  ["2014-12-06", "Anime Festival Asia Singapore 2014", "Suntec Singapore Convention & Exhibition Centre", "https://www.lisani.jp/0000001454/", "仅找到 3 首经演出报道确认的歌曲，已按 partial 导入；完整曲序仍待补。"],
  ["2016-06-11", "AnimeCon 2016", "World Forum", "https://nbcuni-music.com/fripside/news/list00010027.html", "已由官方资料确认演出，但未找到可靠公开歌单。"],
  ["2017-11-26", "C3AFA Singapore 2017", "Suntec Singapore Convention & Exhibition Centre", "https://fripside.net/contents/521687", "已确认 fripSide 出演，但未找到可靠公开歌单。"],
] : [
  ["2017-11-26", "C3AFA Singapore 2017", "Suntec Singapore Convention & Exhibition Centre", "https://fripside.net/contents/521687", "已确认 fripSide 出演，但未找到可靠公开歌单。"],
  ["2020-03-01", "アニソン！プレミアム！ #17", "NHKホール", "", "生产库已有活动；未找到足以确认完整曲序的来源。"],
  ["2020-10-06", "オダイバ!!超次元音楽祭 2020", "ONLINE", "", "生产库已有活动；未找到足以确认完整曲序的来源。"],
];

const report = {
  generated_at: now,
  status: "ready",
  range: { events: [rangeStart, rangeEnd], setlists: [rangeStart, setlistRangeEnd] },
  methodology: [
    "LiveFans 公演检索用于发现候选场次与用户投稿曲序；官方巡演页和官方音乐节档案用于校正演出事实。",
    "多艺人活动只保留演出者字段含 fripSide 的歌曲；fripSide 单独公演保留嘉宾合作段落。",
    "官方档案歌单标记为 official；LiveFans、setlist.fm 与观众记录标记为 reported。",
    "歌单标题采用巡演/活动简称、场馆名与 Day 1/2，避免把完整宣传标题重复放入卡片。",
    "没有可靠曲序的场次不生成歌单，另列人工补全清单。",
  ],
  candidate_count: research.events.length,
  excluded_candidates: research.events.some((event) => event.eventId === "861176")
    ? [{ event_id: "861176", date: "2017-09-16", title: "エモ☆ハピ vol.5", reason: "仅见 LiveFans 单条无歌单记录，未能用官方或其他公开来源确认 fripSide 本人出演。" }]
    : [],
  event_count: eventRecords.length,
  event_counts_by_year: Object.fromEntries([...new Set(eventRecords.map((event) => event.date.slice(0, 4)))].map((year) => [year, eventRecords.filter((event) => event.date.startsWith(year)).length])),
  setlist_count: setlistReport.length,
  setlist_entry_count: setlistRows.length,
  setlists: setlistReport,
  new_live_only_song_count: newLiveOnlySongs.size,
  new_live_only_songs: [...newLiveOnlySongs.values()],
  manual_backlog_count: backlog.length,
};

await mkdir(resolve("data/normalized"), { recursive: true });
await mkdir(resolve("data/reports"), { recursive: true });
await mkdir(resolve("data/research"), { recursive: true });
await writeFile(eventsSqlPath, `${eventStatements.join("\n\n")}\n`);
await writeFile(setlistsCsvPath, `${setlistHeaders.map(csvCell).join(",")}\n${setlistRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);
await writeFile(emptyReleasesPath, `${releaseHeaders.join(",")}\n`);
await writeFile(backlogPath, `date,event,venue,source_url,reason\n${backlog.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`活动 ${report.event_count} 场；${rangeStart.slice(0, 4)}–${setlistRangeEnd.slice(0, 4)} 歌单 ${report.setlist_count} 场；演唱记录 ${report.setlist_entry_count} 条。`);
console.log(`Live-only 歌曲 ${report.new_live_only_song_count} 首；待人工补全 ${report.manual_backlog_count} 场。`);
console.log(`写入 ${eventsSqlPath}`);
console.log(`写入 ${setlistsCsvPath}`);
