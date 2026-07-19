import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const official = "fripSide official Discography";

function original(songTitle, songSlug, options = {}) {
  return {
    songTitle,
    songSlug,
    displayTitle: options.displayTitle ?? songTitle,
    aliases: options.aliases ?? "",
    firstReleaseDate: options.firstReleaseDate,
    originalArtist: options.originalArtist ?? "fripSide",
    versionSlug: options.versionSlug ?? `${songSlug}-original`,
    versionTitle: options.versionTitle ?? songTitle,
    versionLabel: options.versionLabel ?? "original",
    versionReleaseDate: options.versionReleaseDate,
    artistCredit: options.artistCredit ?? "fripSide",
    isOriginal: true,
  };
}

function variant(songTitle, songSlug, versionTitle, versionSlug, versionLabel, options = {}) {
  return {
    songTitle,
    songSlug,
    displayTitle: options.displayTitle ?? versionTitle,
    aliases: options.aliases ?? "",
    firstReleaseDate: options.firstReleaseDate,
    originalArtist: options.originalArtist ?? "fripSide",
    versionSlug,
    versionTitle,
    versionLabel,
    versionReleaseDate: options.versionReleaseDate,
    artistCredit: options.artistCredit ?? "fripSide",
    parentVersionSlug: options.parentVersionSlug ?? `${songSlug}-original`,
    parentVersionTitle: options.parentVersionTitle ?? songTitle,
    parentVersionLabel: options.parentVersionLabel ?? "original",
    parentArtistCredit: options.parentArtistCredit ?? "fripSide (earlier phase)",
    parentReleaseDate: options.parentReleaseDate,
    relationType: options.relationType ?? "cover_of",
    isOriginal: false,
  };
}

function instrumental(songTitle, songSlug, parentTitle, parentSlug, versionSlug, options = {}) {
  return variant(songTitle, songSlug, `${parentTitle} [instrumental]`, versionSlug, `${options.parentLabel ?? "version"} instrumental`, {
    ...options,
    displayTitle: options.displayTitle ?? `${parentTitle}[instrumental]`,
    parentVersionSlug: parentSlug,
    parentVersionTitle: parentTitle,
    parentVersionLabel: options.parentLabel ?? "version",
    parentArtistCredit: options.parentArtistCredit ?? "fripSide",
    relationType: "instrumental_of",
  });
}

const releases = [
  {
    slug: "double-decades",
    title: "double Decades",
    type: "album",
    date: "2022-10-19",
    catalogNumber: "GNCA-1627",
    edition: "通常盤CD／初回限定盤Disc 1共通",
    sourceUrl: "https://fripside.net/musics/12522",
    notes: "fripSide 20th Anniversary Concept Album；Phase 1/2作品的Phase 3翻唱与四位主唱共同演唱的新曲。",
    discs: [[
      original("double Decades", "double-decades", { displayTitle: "double Decades (vocal: nao, Yoshino Nanjo, Mao Uesugi, Hisayo Abe)", artistCredit: "fripSide feat. nao, Yoshino Nanjo, Mao Uesugi & Hisayo Abe" }),
      variant("magicaride", "magicaride", "magicaride -version 2022-", "magicaride-version-2022", "version 2022", { parentArtistCredit: "fripSide (Phase 1)" }),
      variant("BLACKFOX", "blackfox", "BLACKFOX -version 2022-", "blackfox-version-2022", "version 2022", { parentArtistCredit: "fripSide (Phase 2)" }),
      variant("trusty snow", "trusty-snow", "trusty snow -version 2022-", "trusty-snow-version-2022", "version 2022", { parentArtistCredit: "fripSide (Phase 2)" }),
      variant("fermata～Akkord:fortissimo～", "fermata-akkord-fortissimo", "fermata～Akkord:fortissimo～ -version 2022-", "fermata-akkord-fortissimo-version-2022", "version 2022", { parentArtistCredit: "fripSide (Phase 2)" }),
      variant("transitory orbit", "transitory-orbit", "transitory orbit -version 2022-", "transitory-orbit-version-2022", "version 2022", { artistCredit: "fripSide (Mao Uesugi vocal)", parentArtistCredit: "fripSide (Phase 1)" }),
      variant("LEVEL5-judgelight-", "level5-judgelight", "LEVEL5-judgelight- -version 2022-", "level5-judgelight-version-2022", "version 2022", { aliases: "LEVEL５-judgelight-", parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2010-02-17" }),
      variant("come to mind", "come-to-mind", "come to mind -version 2022-", "come-to-mind-version-2022", "version 2022", { parentArtistCredit: "fripSide (Phase 1)" }),
      variant("crescendo", "crescendo", "crescendo -version 2022-", "crescendo-version-2022", "version 2022", { parentArtistCredit: "fripSide (Phase 1)" }),
      variant("sister's noise", "sisters-noise", "sister's noise -version 2022-", "sisters-noise-version-2022", "version 2022", { aliases: "sister’s noise", parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2013-05-08" }),
      variant("before dawn daybreak", "before-dawn-daybreak", "before dawn daybreak -version 2022-", "before-dawn-daybreak-version-2022", "version 2022", { artistCredit: "fripSide (Hisayo Abe vocal)", parentArtistCredit: "fripSide (Phase 1)" }),
    ]],
  },
  {
    slug: "infinite-resonance",
    title: "infinite Resonance",
    type: "album",
    date: "2022-10-19",
    catalogNumber: "GNCA-1628",
    edition: "通常盤CD／初回限定盤Disc 2共通",
    sourceUrl: "https://fripside.net/musics/12523",
    notes: "fripSide Phase 3 1st original album。",
    discs: [[
      original("infinite Resonance", "infinite-resonance"),
      original("dawn of infinity", "dawn-of-infinity", { firstReleaseDate: "2022-05-18", versionReleaseDate: "2022-05-18" }),
      original("Flames", "flames", { displayTitle: "Flames (vocal: Hisayo Abe)", artistCredit: "fripSide (Hisayo Abe vocal)" }),
      original("Insoluble Snow", "insoluble-snow"),
      variant("trust in you", "trust-in-you", "trust in you -version 2022-", "trust-in-you-version-2022", "version 2022", { parentArtistCredit: "fripSide (Phase 1)" }),
      original("with a smile", "with-a-smile", { displayTitle: "with a smile (vocal: Hisayo Abe)", artistCredit: "fripSide (Hisayo Abe vocal)" }),
      original("Your Way", "your-way"),
      original("Distance", "distance", { displayTitle: "Distance (vocal: Mao Uesugi)", artistCredit: "fripSide (Mao Uesugi vocal)" }),
      original("Reach for the light", "reach-for-the-light", { displayTitle: "Reach for the light (vocal: Mao Uesugi)", artistCredit: "fripSide (Mao Uesugi vocal)" }),
      original("Forget-me-not", "forget-me-not"),
      original("an Effect of Fate", "an-effect-of-fate"),
      original("New World", "new-world"),
      original("Shape of Delight", "shape-of-delight"),
    ]],
  },
  {
    slug: "infinite-resonance-2",
    title: "infinite Resonance 2",
    type: "album",
    date: "2023-11-08",
    catalogNumber: "GNCA-1654 / GNCA-1655",
    edition: "初回限定盤／通常盤共通CD",
    sourceUrl: "https://fripside.net/musics/13906",
    notes: "fripSide Phase 3 2nd original album。",
    discs: [[
      original("Invisible Wings", "invisible-wings"),
      original("Red Liberation", "red-liberation", { firstReleaseDate: "2023-10-11", versionReleaseDate: "2023-10-11" }),
      variant("final phase", "final-phase", "final phase -version2023-", "final-phase-version-2023", "version 2023", { parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2020-02-26" }),
      original("Freezing rain", "freezing-rain"),
      variant("save me again", "save-me-again", "save me again -version2023-", "save-me-again-version-2023", "version 2023", { parentArtistCredit: "fripSide (Phase 2)" }),
      original("The Light of Darkness", "the-light-of-darkness"),
      variant("black bullet", "black-bullet", "black bullet -version2023-", "black-bullet-version-2023", "version 2023", { parentArtistCredit: "fripSide (Phase 2)" }),
      variant("Two souls -toward the truth-", "two-souls-toward-the-truth", "Two souls -toward the truth- -version2023-", "two-souls-toward-the-truth-version-2023", "version 2023", { parentArtistCredit: "fripSide (Phase 2)" }),
      original("Trust in my soul", "trust-in-my-soul", { displayTitle: "Trust in my soul (vocal: Hisayo Abe)", artistCredit: "fripSide (Hisayo Abe vocal)" }),
      variant("dual existence", "dual-existence", "dual existence -version2023-", "dual-existence-version-2023", "version 2023", { parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2020-08-19" }),
      original("Distance to starry sky", "distance-to-starry-sky", { displayTitle: "Distance to starry sky (vocal: Mao Uesugi)", artistCredit: "fripSide (Mao Uesugi vocal)" }),
      original("Newage", "newage"),
      original("You", "you"),
    ]],
  },
  {
    slug: "infinite-resonance-3",
    title: "infinite Resonance 3",
    type: "album",
    date: "2024-10-09",
    catalogNumber: "GNCA-1675 / GNCA-1676",
    edition: "初回限定盤／通常盤共通CD",
    sourceUrl: "https://fripside.net/musics/15538",
    notes: "fripSide Phase 3 3rd original album。",
    discs: [[
      original("Starlit Moment", "starlit-moment"),
      original("Unbroken Resolve", "unbroken-resolve"),
      original("Solitude in Autumn", "solitude-in-autumn"),
      original("Winterfade", "winterfade"),
      original("Gratitude to You", "gratitude-to-you", { displayTitle: "Gratitude to You (vocal: Hisayo Abe)", artistCredit: "fripSide (Hisayo Abe vocal)" }),
      variant("Secret Operation", "secret-operation", "Secret Operation -fripSide Edition-", "secret-operation-fripside-edition", "fripSide Edition", { firstReleaseDate: "2024-08-21", versionReleaseDate: "2024-10-09", parentVersionSlug: "secret-operation-single-version", parentVersionTitle: "Secret Operation", parentVersionLabel: "single version", parentArtistCredit: "fripSide feat. Yoshino Nanjo", parentReleaseDate: "2024-08-21", relationType: "re-recording_of" }),
      original("Twinkle Star Nights", "twinkle-star-nights"),
      variant("killing bites", "killing-bites", "killing bites -version2024-", "killing-bites-version-2024", "version 2024", { parentArtistCredit: "fripSide (Phase 2)" }),
      original("Salvation", "salvation", { displayTitle: "Salvation (vocal: Mao Uesugi)", artistCredit: "fripSide (Mao Uesugi vocal)" }),
      original("Turn Night Into Day", "turn-night-into-day"),
      original("Against the World", "against-the-world"),
      variant("Hesitation Snow", "hesitation-snow", "Hesitation Snow -version2024-", "hesitation-snow-version-2024", "version 2024", { parentArtistCredit: "fripSide (Phase 1)" }),
      variant("future gazer", "future-gazer", "future gazer -version2024-", "future-gazer-version-2024", "version 2024", { parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2010-10-13" }),
    ]],
  },
  {
    slug: "a-certain-scientific-railgun-music-chronicles",
    title: "とある科学の超音楽集 −A Certain Scientific Railgun：Music Chronicles−",
    type: "compilation",
    date: "2025-09-24",
    catalogNumber: "WPZL-32229/32",
    edition: "初回生産限定盤CD 1–3",
    sourceUrl: "https://fripside.net/musics/19132",
    notes: "官方归类为ALBUM；本站按主題歌合集规范化为Compilation。仅收录三个音频CD，不把附带Blu-ray或门店特典Remix计入标准曲目。",
    discs: [
      [
        original("only my railgun", "only-my-railgun", { firstReleaseDate: "2009-11-04", versionReleaseDate: "2009-11-04", artistCredit: "fripSide (Phase 2)" }),
        original("LEVEL5-judgelight-", "level5-judgelight", { aliases: "LEVEL５-judgelight-", firstReleaseDate: "2010-02-17", versionReleaseDate: "2010-02-17", artistCredit: "fripSide (Phase 2)" }),
        original("future gazer", "future-gazer", { firstReleaseDate: "2010-10-13", versionReleaseDate: "2010-10-13", artistCredit: "fripSide (Phase 2)" }),
        original("way to answer", "way-to-answer", { firstReleaseDate: "2011-12-14", versionReleaseDate: "2011-12-14", artistCredit: "fripSide (Phase 2)" }),
        original("sister's noise", "sisters-noise", { aliases: "sister’s noise", firstReleaseDate: "2013-05-08", versionReleaseDate: "2013-05-08", artistCredit: "fripSide (Phase 2)" }),
        original("eternal reality", "eternal-reality", { firstReleaseDate: "2013-08-21", versionReleaseDate: "2013-08-21", artistCredit: "fripSide (Phase 2)" }),
        original("final phase", "final-phase", { firstReleaseDate: "2020-02-26", versionReleaseDate: "2020-02-26", artistCredit: "fripSide (Phase 2)" }),
        original("dual existence", "dual-existence", { firstReleaseDate: "2020-08-19", versionReleaseDate: "2020-08-19", artistCredit: "fripSide (Phase 2)" }),
        variant("only my railgun", "only-my-railgun", "only my railgun -version2020-", "only-my-railgun-version-2020", "version 2020", { firstReleaseDate: "2009-11-04", versionReleaseDate: "2020-02-26", parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2009-11-04", relationType: "re-recording_of" }),
        variant("only my railgun", "only-my-railgun", "only my railgun -15th Anniversary version-", "only-my-railgun-15th-anniversary-version", "15th Anniversary version", { displayTitle: "only my railgun -15th Anniversary version- [Phase 2 & Phase 3]", firstReleaseDate: "2009-11-04", versionReleaseDate: "2024-12-18", artistCredit: "fripSide (Phase 2 & Phase 3)", parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2009-11-04", relationType: "re-recording_of" }),
      ],
      [
        variant("only my railgun", "only-my-railgun", "only my railgun -version2024-", "only-my-railgun-version-2024", "version 2024", { firstReleaseDate: "2009-11-04", versionReleaseDate: "2024-12-18", parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2009-11-04" }),
        variant("LEVEL5-judgelight-", "level5-judgelight", "LEVEL5-judgelight- -version 2022-", "level5-judgelight-version-2022", "version 2022", { aliases: "LEVEL５-judgelight-", firstReleaseDate: "2010-02-17", versionReleaseDate: "2022-10-19", parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2010-02-17" }),
        variant("future gazer", "future-gazer", "future gazer -version2024-", "future-gazer-version-2024", "version 2024", { firstReleaseDate: "2010-10-13", versionReleaseDate: "2024-10-09", parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2010-10-13" }),
        variant("way to answer", "way-to-answer", "way to answer -version2025-", "way-to-answer-version-2025", "version 2025", { firstReleaseDate: "2011-12-14", versionReleaseDate: "2025-09-24", parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2011-12-14" }),
        variant("sister's noise", "sisters-noise", "sister's noise -version 2022-", "sisters-noise-version-2022", "version 2022", { displayTitle: "sister's noise -version2022-", aliases: "sister’s noise", firstReleaseDate: "2013-05-08", versionReleaseDate: "2022-10-19", parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2013-05-08" }),
        variant("eternal reality", "eternal-reality", "eternal reality -version2025-", "eternal-reality-version-2025", "version 2025", { firstReleaseDate: "2013-08-21", versionReleaseDate: "2025-09-12", parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2013-08-21" }),
        variant("final phase", "final-phase", "final phase -version2023-", "final-phase-version-2023", "version 2023", { firstReleaseDate: "2020-02-26", versionReleaseDate: "2023-11-08", parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2020-02-26" }),
        variant("dual existence", "dual-existence", "dual existence -version2023-", "dual-existence-version-2023", "version 2023", { firstReleaseDate: "2020-08-19", versionReleaseDate: "2023-11-08", parentArtistCredit: "fripSide (Phase 2)", parentReleaseDate: "2020-08-19" }),
        original("PHASE NEXT", "phase-next"),
      ],
      [
        instrumental("only my railgun", "only-my-railgun", "only my railgun -version2024-", "only-my-railgun-version-2024", "only-my-railgun-version-2024-instrumental", { parentLabel: "version 2024", firstReleaseDate: "2009-11-04" }),
        instrumental("LEVEL5-judgelight-", "level5-judgelight", "LEVEL5-judgelight- -version 2022-", "level5-judgelight-version-2022", "level5-judgelight-version-2022-instrumental", { parentLabel: "version 2022", aliases: "LEVEL５-judgelight-", firstReleaseDate: "2010-02-17" }),
        instrumental("future gazer", "future-gazer", "future gazer -version2024-", "future-gazer-version-2024", "future-gazer-version-2024-instrumental", { parentLabel: "version 2024", firstReleaseDate: "2010-10-13" }),
        instrumental("way to answer", "way-to-answer", "way to answer -version2025-", "way-to-answer-version-2025", "way-to-answer-version-2025-instrumental", { parentLabel: "version 2025", firstReleaseDate: "2011-12-14" }),
        instrumental("sister's noise", "sisters-noise", "sister's noise -version 2022-", "sisters-noise-version-2022", "sisters-noise-version-2022-instrumental", { displayTitle: "sister's noise -version2022-[instrumental]", parentLabel: "version 2022", aliases: "sister’s noise", firstReleaseDate: "2013-05-08" }),
        instrumental("eternal reality", "eternal-reality", "eternal reality -version2025-", "eternal-reality-version-2025", "eternal-reality-version-2025-instrumental", { parentLabel: "version 2025", firstReleaseDate: "2013-08-21" }),
        instrumental("final phase", "final-phase", "final phase -version2023-", "final-phase-version-2023", "final-phase-version-2023-instrumental", { parentLabel: "version 2023", firstReleaseDate: "2020-02-26" }),
        instrumental("dual existence", "dual-existence", "dual existence -version2023-", "dual-existence-version-2023", "dual-existence-version-2023-instrumental", { parentLabel: "version 2023", firstReleaseDate: "2020-08-19" }),
        instrumental("only my railgun", "only-my-railgun", "only my railgun -version2020-", "only-my-railgun-version-2020", "only-my-railgun-version-2020-instrumental", { parentLabel: "version 2020", firstReleaseDate: "2009-11-04" }),
        instrumental("only my railgun", "only-my-railgun", "only my railgun -15th Anniversary version-", "only-my-railgun-15th-anniversary-version", "only-my-railgun-15th-anniversary-version-instrumental", { parentLabel: "15th Anniversary version", parentArtistCredit: "fripSide (Phase 2 & Phase 3)", firstReleaseDate: "2009-11-04" }),
        instrumental("PHASE NEXT", "phase-next", "PHASE NEXT", "phase-next-original", "phase-next-instrumental", { parentLabel: "original", firstReleaseDate: "2025-09-24" }),
      ],
    ],
  },
  {
    slug: "infinite-resonance-4",
    title: "infinite Resonance 4",
    type: "album",
    date: "2026-08-26",
    catalogNumber: "WPZL-32314～5 / WPCL-13787",
    edition: "初回限定盤／通常盤共通CD",
    sourceUrl: "https://fripside.net/musics/20902",
    notes: "官方已公布完整14曲；计划发行日为2026-08-26，导入时尚未发行。",
    discs: [[
      original("Where the Light Leads Us", "where-the-light-leads-us"),
      original("The Edge of Reality", "the-edge-of-reality"),
      original("Re:build the Order of Stars", "rebuild-the-order-of-stars"),
      variant("nostalgia", "nostalgia", "nostalgia -version2026-", "nostalgia-version-2026", "version 2026", { parentArtistCredit: "fripSide (earlier phase)" }),
      original("Our Last Place", "our-last-place"),
      original("Find the Way", "find-the-way"),
      original("unwavering One thing", "unwavering-one-thing", { displayTitle: "unwavering One thing (vocal: Mao Uesugi)", artistCredit: "fripSide (Mao Uesugi vocal)" }),
      original("Where We Belong", "where-we-belong"),
      original("Brand New Me!", "brand-new-me"),
      original("Wandering Traveler", "wandering-traveler", { displayTitle: "Wandering Traveler (vocal: Hisayo Abe)", firstReleaseDate: "2025-06-15", versionReleaseDate: "2025-06-15", artistCredit: "fripSide (Hisayo Abe vocal)" }),
      variant("PHASE NEXT", "phase-next", "PHASE NEXT -iR4 version-", "phase-next-ir4-version", "iR4 version", { firstReleaseDate: "2025-09-24", versionReleaseDate: "2026-08-26", parentVersionSlug: "phase-next-original", parentVersionTitle: "PHASE NEXT", parentVersionLabel: "original", parentArtistCredit: "fripSide", parentReleaseDate: "2025-09-24", relationType: "rearrangement_of" }),
      variant("My Own Way", "my-own-way", "My Own Way -version2026-", "my-own-way-version-2026", "version 2026", { parentArtistCredit: "fripSide (earlier phase)" }),
      original("Across the Changing Sky", "across-the-changing-sky"),
      original("Bound in the Melody", "bound-in-the-melody"),
    ]],
  },
];

const headers = [
  "release_slug", "release_title", "release_type", "release_date", "catalog_number", "edition",
  "disc_number", "track_number", "display_title", "song_slug", "song_title", "song_aliases",
  "song_first_release_date", "original_artist", "version_slug", "version_title", "version_label",
  "version_release_date", "artist_credit", "parent_version_slug", "parent_version_title",
  "parent_version_label", "parent_artist_credit", "parent_release_date", "relation_type", "source_url",
  "release_notes", "song_notes", "version_notes", "track_notes",
];

function csv(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const rows = [];
for (const release of releases) {
  release.discs.forEach((disc, discIndex) => {
    disc.forEach((track, trackIndex) => {
      const record = {
        release_slug: release.slug,
        release_title: release.title,
        release_type: release.type,
        release_date: release.date,
        catalog_number: release.catalogNumber,
        edition: release.edition,
        disc_number: discIndex + 1,
        track_number: trackIndex + 1,
        display_title: track.displayTitle,
        song_slug: track.songSlug,
        song_title: track.songTitle,
        song_aliases: track.aliases,
        song_first_release_date: track.firstReleaseDate ?? (track.isOriginal ? release.date : ""),
        original_artist: track.originalArtist,
        version_slug: track.versionSlug,
        version_title: track.versionTitle,
        version_label: track.versionLabel,
        version_release_date: track.versionReleaseDate ?? release.date,
        artist_credit: track.artistCredit,
        parent_version_slug: track.parentVersionSlug,
        parent_version_title: track.parentVersionTitle,
        parent_version_label: track.parentVersionLabel,
        parent_artist_credit: track.parentArtistCredit,
        parent_release_date: track.parentReleaseDate,
        relation_type: track.relationType,
        source_url: release.sourceUrl,
        release_notes: release.notes,
        song_notes: "",
        version_notes: "",
        track_notes: "",
      };
      rows.push(headers.map((header) => csv(record[header])).join(","));
    });
  });
}

const outputPath = resolve(process.argv[2] || "data/normalized/fripside-phase3-album-tracks.csv");
const reportPath = resolve("data/reports/fripside-phase3-albums-summary.json");
const setlistPath = resolve("data/normalized/fripside-phase3-empty-setlists.csv");
const songSlugs = new Set(releases.flatMap((release) => release.discs.flat()).map((track) => track.songSlug));
const versionSlugs = new Set(releases.flatMap((release) => release.discs.flat()).flatMap((track) => [track.versionSlug, track.parentVersionSlug].filter(Boolean)));
const relations = new Set(
  releases.flatMap((release) => release.discs.flat())
    .filter((track) => track.relationType)
    .map((track) => `${track.versionSlug}|${track.parentVersionSlug}|${track.relationType}`),
).size;
const report = {
  generated_at: new Date().toISOString(),
  source: official,
  scope: "Official ALBUM entries from 2022-10-19 onward associated with fripSide Phase 3",
  releases: releases.map((release) => ({ title: release.title, date: release.date, source_url: release.sourceUrl, track_count: release.discs.reduce((sum, disc) => sum + disc.length, 0) })),
  counts: { releases: releases.length, track_positions: rows.length, songs: songSlugs.size, versions_including_relation_parents: versionSlugs.size, version_relations: relations },
  excluded: [
    { title: "double Decades＋infinite Resonance", source_url: "https://fripside.net/musics/12524", reason: "2CD套装与两张独立Album曲目完全重复，保留独立发行物以避免重复统计。" },
    { title: "とある科学の超音楽集 店铺特典Remix CD", source_url: "https://fripside.net/musics/19132", reason: "属于零售商特典，不是标准版三张音频CD的正式Track位置。" },
    { title: "各初回限定盘附带Live Blu-ray", reason: "本批目标为专辑音频曲目；影像歌单后续进入Live setlist数据。" },
  ],
};

await mkdir(resolve("data/normalized"), { recursive: true });
await mkdir(resolve("data/reports"), { recursive: true });
await writeFile(outputPath, `${headers.join(",")}\n${rows.join("\n")}\n`, "utf8");
await writeFile(setlistPath, "event_slug,performance_label,setlist_title,completeness,confidence,position,section,display_title,song_slug,song_title,song_aliases,song_first_release_date,original_artist,version_slug,version_title,version_label,artist_credit,medley_group,source_url,setlist_notes,song_notes,entry_notes\n", "utf8");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`已生成 ${outputPath}`);
console.log(`发行物 ${releases.length}；曲目位置 ${rows.length}；作品 ${songSlugs.size}；版本 ${versionSlugs.size}；版本关系 ${relations}。`);
console.log(`核验报告：${reportPath}`);
