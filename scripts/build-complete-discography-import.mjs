import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const headers = [
  "release_slug", "release_title", "release_type", "release_date", "catalog_number", "edition",
  "disc_number", "track_number", "display_title", "song_slug", "song_title", "song_aliases",
  "song_first_release_date", "original_artist", "version_slug", "version_title", "version_label",
  "version_release_date", "artist_credit", "parent_version_slug", "parent_version_title",
  "parent_version_label", "parent_artist_credit", "parent_release_date", "relation_type", "source_url",
  "release_notes", "song_notes", "version_notes", "track_notes",
];

const paths = {
  existing: resolve("data/normalized/fripside-phase3-album-tracks.csv"),
  earlyResearch: resolve("data/research/discography-2003-2013.json"),
  earlyNorm: resolve("data/research/discography-2003-2013-normalization.json"),
  middleResearch: resolve("data/research/discography-2014-2020.json"),
  middleNorm: resolve("data/research/discography-2014-2020-normalization.json"),
  recentResearch: resolve("data/research/discography-2021-2026.json"),
  recentNorm: resolve("data/research/discography-2021-2026-normalization.json"),
  output: resolve(process.argv[2] || "data/normalized/fripside-complete-discography-tracks.csv"),
  report: resolve("data/reports/fripside-complete-discography-summary.json"),
  emptySetlists: resolve("data/normalized/fripside-complete-discography-empty-setlists.csv"),
};

function clean(value) {
  return value == null ? "" : String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function csv(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

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
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((item) => item.some((cell) => cell.trim()));
}

function rowObject(headerRow, row) {
  return Object.fromEntries(headerRow.map((header, index) => [header, clean(row[index])]));
}

function stripPhasePrefix(title) {
  return clean(title).replace(/^[【〖]\s*第1期\s*[】〗]\s*/, "");
}

function audioDiscs(edition) {
  return edition.discs.filter((disc) => !/dvd|blu.?ray/i.test(disc.media) && disc.tracks.length > 0);
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function editionSuffix(name) {
  return clean(name)
    .replace(/[（(].*?[)）]/g, "")
    .replace(/CD|Blu-ray|DVD|＋|\+/gi, "")
    .trim() || clean(name);
}

const [existingText, earlyResearch, earlyNorm, middleResearch, middleNorm, recentResearch, recentNorm] = await Promise.all([
  readFile(paths.existing, "utf8"),
  readFile(paths.earlyResearch, "utf8").then(JSON.parse),
  readFile(paths.earlyNorm, "utf8").then(JSON.parse),
  readFile(paths.middleResearch, "utf8").then(JSON.parse),
  readFile(paths.middleNorm, "utf8").then(JSON.parse),
  readFile(paths.recentResearch, "utf8").then(JSON.parse),
  readFile(paths.recentNorm, "utf8").then(JSON.parse),
]);

const records = new Map();
const versions = new Map();
const songDates = new Map();
const versionDates = new Map();
const songArtists = new Map();
const releaseSources = new Set();
const uncertainties = [];

function earlier(current, candidate) {
  if (!candidate) return current || "";
  if (!current || candidate < current) return candidate;
  return current;
}

function registerVersion(input) {
  if (!input.version_slug || !input.song_slug) throw new Error(`Version is missing identity: ${JSON.stringify(input)}`);
  const normalized = {
    song_slug: input.song_slug,
    song_title: input.song_title,
    version_slug: input.version_slug,
    version_title: input.version_title,
    version_label: input.version_label || "original",
    artist_credit: input.artist_credit || "fripSide",
    parent_version_slug: input.parent_version_slug || "",
    relation_type: input.relation_type || "",
    uncertainty_reason: input.uncertainty_reason || "",
  };
  const existing = versions.get(normalized.version_slug);
  if (existing && existing.song_slug !== normalized.song_slug) {
    throw new Error(`Version slug ${normalized.version_slug} maps to both ${existing.song_slug} and ${normalized.song_slug}`);
  }
  if (!existing) versions.set(normalized.version_slug, normalized);
  else {
    for (const field of ["song_title", "version_title", "version_label", "artist_credit", "parent_version_slug", "relation_type"]) {
      if (!existing[field] && normalized[field]) existing[field] = normalized[field];
    }
  }
  if (normalized.uncertainty_reason) uncertainties.push({ version_slug: normalized.version_slug, reason: normalized.uncertainty_reason });
}

function addTrack(input) {
  registerVersion(input);
  const key = `${input.release_slug}|${input.disc_number}|${input.track_number}`;
  const record = Object.fromEntries(headers.map((header) => [header, clean(input[header])]));
  const existing = records.get(key);
  if (existing && existing.version_slug !== record.version_slug) {
    throw new Error(`Release slot conflict ${key}: ${existing.version_slug} vs ${record.version_slug}`);
  }
  records.set(key, record);
  releaseSources.add(record.source_url);
  songDates.set(record.song_slug, earlier(songDates.get(record.song_slug), record.song_first_release_date || record.release_date));
  versionDates.set(record.version_slug, earlier(versionDates.get(record.version_slug), record.version_release_date || record.release_date));
  if (!songArtists.has(record.song_slug) || (record.song_first_release_date && record.song_first_release_date === songDates.get(record.song_slug))) {
    songArtists.set(record.song_slug, record.original_artist || record.artist_credit || "fripSide");
  }
}

function baseRecord({ release, track, mapping, catalogNumber, edition, releaseSlug, releaseTitle, releaseNotes }) {
  return {
    release_slug: releaseSlug,
    release_title: releaseTitle,
    release_type: release.normalized_release_type,
    release_date: release.release_date,
    catalog_number: catalogNumber,
    edition,
    disc_number: track.disc_number,
    track_number: track.track_number,
    display_title: track.display_title || mapping.version_title,
    song_slug: mapping.song_slug,
    song_title: mapping.canonical_song_title,
    song_aliases: "",
    song_first_release_date: "",
    original_artist: mapping.artist_credit || "fripSide",
    version_slug: mapping.version_slug,
    version_title: mapping.version_title,
    version_label: mapping.version_label || "original",
    version_release_date: release.release_date,
    artist_credit: mapping.artist_credit || "fripSide",
    parent_version_slug: mapping.relation_type ? mapping.parent_version_slug || "" : "",
    parent_version_title: "",
    parent_version_label: "",
    parent_artist_credit: "",
    parent_release_date: "",
    relation_type: mapping.relation_type || "",
    source_url: release.source_url,
    release_notes: releaseNotes || `fripSide official Discography：${release.official_type || "audio release"}.`,
    song_notes: "",
    version_notes: mapping.uncertainty_reason || "",
    track_notes: track.track_notes || "",
    uncertainty_reason: mapping.uncertainty_reason || "",
  };
}

const [existingHeaders, ...existingRows] = parseCsv(existingText.replace(/^\uFEFF/, ""));
for (const row of existingRows) {
  const record = rowObject(existingHeaders, row);
  if (record.release_slug === "double-decades" || record.release_slug === "infinite-resonance") record.edition = "通常盤（CD）";
  if (record.release_slug === "a-certain-scientific-railgun-music-chronicles") record.edition = "初回生産限定盤（3CD＋Blu-ray）";
  addTrack({
    ...record,
    song_title: record.song_title,
    canonical_song_title: record.song_title,
    uncertainty_reason: "",
  });
}

const earlyResearchByUrl = new Map(earlyResearch.releases.map((release) => [release.source_url, release]));
const earlyTrackMap = new Map(earlyNorm.track_normalization.map((track) => [clean(track.source_title), track]));
for (const mapping of earlyNorm.track_normalization) {
  registerVersion({
    song_slug: mapping.song_slug,
    song_title: mapping.canonical_song_title,
    version_slug: mapping.version_slug,
    version_title: mapping.version_title,
    version_label: mapping.version_label,
    artist_credit: mapping.artist_credit,
    parent_version_slug: mapping.parent_version_slug,
    relation_type: mapping.relation_type,
    uncertainty_reason: mapping.uncertainty_reason,
  });
}

for (const release of earlyNorm.releases) {
  const research = earlyResearchByUrl.get(release.source_url);
  if (!research) throw new Error(`Missing early research for ${release.source_url}`);
  for (const group of release.edition_groups) {
    const sourceEdition = research.editions[(group.editions[0]?.source_edition_index || 1) - 1];
    if (!sourceEdition) throw new Error(`Missing edition for ${group.normalized_release_slug}`);
    const catalogs = unique(group.editions.map((edition) => edition.catalog_number));
    const editionNames = unique(group.editions.map((edition) => edition.name));
    const split = release.edition_groups.length > 1;
    const releaseTitle = split && group.normalized_release_slug !== release.release_slug
      ? `${stripPhasePrefix(release.official_title)}（${editionSuffix(group.preferred_edition_name)}）`
      : stripPhasePrefix(release.official_title);
    for (const [discIndex, disc] of audioDiscs(sourceEdition).entries()) {
      for (const track of disc.tracks) {
        const mapping = earlyTrackMap.get(clean(track.title));
        if (!mapping) throw new Error(`Missing early track normalization: ${track.title}`);
        addTrack(baseRecord({
          release,
          track: { disc_number: disc.number || discIndex + 1, track_number: track.number, display_title: clean(track.title) },
          mapping,
          catalogNumber: catalogs.join(" / ") || group.preferred_catalog_number || "",
          edition: editionNames.join("／") || group.preferred_edition_name,
          releaseSlug: group.normalized_release_slug,
          releaseTitle,
          releaseNotes: `fripSide official Discography；${group.reason}`,
        }));
      }
    }
  }
}

const middleResearchByUrl = new Map(middleResearch.releases.map((release) => [release.source_url, release]));
const middleTrackMap = new Map(middleNorm.songs.map((track) => [clean(track.source_title), track]));
const middleVersionMap = new Map();
function middleArtistCredit(mapping) {
  if (mapping.song_slug === "the-end-of-escape") {
    return mapping.version_slug === "the-end-of-escape-fripside-edition" ? "fripSide" : "fripSide×angela";
  }
  if (mapping.song_slug === "boku-wa-boku-de-atte") return "angela×fripSide";
  return "fripSide";
}
for (const mapping of middleNorm.songs) {
  if (!middleVersionMap.has(mapping.version_slug)) middleVersionMap.set(mapping.version_slug, mapping);
  registerVersion({
    song_slug: mapping.song_slug,
    song_title: mapping.canonical_song_title,
    version_slug: mapping.version_slug,
    version_title: mapping.version_title,
    version_label: mapping.version_label,
    artist_credit: middleArtistCredit(mapping),
    parent_version_slug: mapping.parent_version_slug,
    relation_type: mapping.relation_type,
    uncertainty_reason: mapping.uncertainty_reason,
  });
}

for (const release of middleNorm.releases) {
  const research = middleResearchByUrl.get(release.source_url);
  if (!research) throw new Error(`Missing middle research for ${release.source_url}`);
  for (const group of release.edition_groups) {
    const sourceEdition = research.editions.find((edition) => group.catalog_numbers.includes(edition.catalog_number)) || research.editions[0];
    const sourceDiscs = audioDiscs(sourceEdition);
    const split = release.edition_groups.length > 1;
    const releaseTitle = split ? `${release.source_title}（${editionSuffix(group.edition_names[0])}）` : release.source_title;
    for (const disc of group.normalized_discs) {
      const sourceDisc = sourceDiscs.find((item) => item.number === disc.disc_number) || sourceDiscs[disc.disc_number - 1];
      for (const track of disc.tracks) {
        const sourceTrack = sourceDisc?.tracks.find((item) => item.number === track.track_number);
        const mapping = (sourceTrack && middleTrackMap.get(clean(sourceTrack.title))) || middleVersionMap.get(track.version_slug);
        if (!mapping) throw new Error(`Missing middle track normalization: ${release.release_slug} ${track.version_slug}`);
        addTrack(baseRecord({
          release: { ...release, official_type: research.official_type },
          track: { disc_number: disc.disc_number, track_number: track.track_number, display_title: clean(sourceTrack?.title) || mapping.version_title },
          mapping: { ...mapping, artist_credit: middleArtistCredit(mapping) },
          catalogNumber: unique(group.catalog_numbers).join(" / "),
          edition: unique(group.edition_names).join("／"),
          releaseSlug: group.suggested_release_slug,
          releaseTitle,
          releaseNotes: `fripSide official Discography；${group.reason}`,
        }));
      }
    }
  }
}

const recentResearchByUrl = new Map(recentResearch.releases.map((release) => [release.source_url, release]));
for (const release of recentNorm.releases.filter((item) => item.track_changes?.length)) {
  const research = recentResearchByUrl.get(release.source_url);
  if (!research) throw new Error(`Missing recent research for ${release.source_url}`);
  const merged = release.edition_normalization.merge_same_audio_editions?.[0];
  const catalogNumbers = unique(merged?.catalog_numbers || research.editions.map((edition) => edition.catalog_number));
  const edition = merged?.normalized_edition || release.edition_normalization.normalized_edition || unique(research.editions.map((item) => item.name)).join("／");
  for (const track of release.track_changes) {
    const mapping = {
      ...track,
      parent_version_slug: track.parent_version?.version_slug || "",
      uncertainty_reason: track.relation_type ? "" : (track.parent_version ? track.notes || "Relation type is not confirmed by the official source." : ""),
      artist_credit: track.version_slug === "secret-operation-yoshino-nanjo-edition" ? "fripSide feat. Yoshino Nanjo" : "fripSide",
    };
    addTrack(baseRecord({
      release: { ...release, release_date: research.release_date },
      track: { disc_number: track.disc_number, track_number: track.track_number, display_title: track.source_title },
      mapping,
      catalogNumber: catalogNumbers.join(" / "),
      edition,
      releaseSlug: release.release_slug,
      releaseTitle: release.title,
      releaseNotes: `fripSide official Discography；官网类别 ${release.official_type}.`,
    }));
  }
}

const standardChronicles = [...records.values()].filter((record) => record.release_slug === "a-certain-scientific-railgun-music-chronicles");
for (const source of standardChronicles) {
  addTrack({
    ...source,
    release_slug: "a-certain-scientific-railgun-music-chronicles-wms-edition",
    release_title: "とある科学の超音楽集 −A Certain Scientific Railgun：Music Chronicles−（WMS専売商品）",
    catalog_number: "WPZL-60066/9",
    edition: "WMS専売商品",
    release_notes: "WMS专卖版；标准3CD共30曲已完整记录。官网另注明附6曲Live音源CD，但未公开曲目和顺序，因此该Bonus CD暂未生成曲目位置。",
    uncertainty_reason: "",
  });
}

const songIdentities = new Map();
for (const version of versions.values()) {
  const candidate = {
    title: version.song_title,
    artist: version.artist_credit || "fripSide",
    date: versionDates.get(version.version_slug) || "9999-12-31",
    original: version.version_label === "original",
  };
  const current = songIdentities.get(version.song_slug);
  if (!current || (candidate.original && !current.original) || (candidate.original === current.original && candidate.date < current.date)) {
    songIdentities.set(version.song_slug, candidate);
  }
}

for (const record of records.values()) {
  const version = versions.get(record.version_slug);
  const song = songIdentities.get(record.song_slug);
  if (version) {
    record.version_title = version.version_title;
    record.version_label = version.version_label;
    record.artist_credit = version.artist_credit;
  }
  if (song) record.song_title = song.title;
  record.song_first_release_date = songDates.get(record.song_slug) || record.song_first_release_date;
  record.original_artist = song?.artist || songArtists.get(record.song_slug) || record.original_artist || "fripSide";
  record.version_release_date = versionDates.get(record.version_slug) || record.version_release_date || record.release_date;
  if (!record.relation_type) {
    record.parent_version_slug = "";
    record.parent_version_title = "";
    record.parent_version_label = "";
    record.parent_artist_credit = "";
    record.parent_release_date = "";
  } else if (record.parent_version_slug) {
    const parent = versions.get(record.parent_version_slug);
    record.parent_version_title = parent?.version_title || record.parent_version_title || record.parent_version_slug;
    record.parent_version_label = parent?.version_label || record.parent_version_label || "original";
    record.parent_artist_credit = parent?.artist_credit || record.parent_artist_credit || "fripSide";
    record.parent_release_date = versionDates.get(record.parent_version_slug) || record.parent_release_date;
  }
}

const sorted = [...records.values()].sort((left, right) =>
  left.release_date.localeCompare(right.release_date)
  || left.release_slug.localeCompare(right.release_slug)
  || Number(left.disc_number) - Number(right.disc_number)
  || Number(left.track_number) - Number(right.track_number));

const releaseSlugs = new Set(sorted.map((record) => record.release_slug));
const songSlugs = new Set(sorted.map((record) => record.song_slug));
const versionSlugs = new Set(sorted.map((record) => record.version_slug));
const relationKeys = new Set(sorted.filter((record) => record.parent_version_slug && record.relation_type)
  .map((record) => `${record.version_slug}|${record.parent_version_slug}|${record.relation_type}`));
const expectedUrls = new Set([...earlyResearch.releases, ...middleResearch.releases, ...recentResearch.releases].map((release) => release.source_url));
const missingSources = [...expectedUrls].filter((url) => !releaseSources.has(url));
if (missingSources.length) throw new Error(`Official audio releases missing from normalized output: ${missingSources.join(", ")}`);

const report = {
  generated_at: new Date().toISOString(),
  source: "https://fripside.net/discography",
  scope: "All 60 official audio Discography entries (ALBUM, SINGLE, DIGITAL) from 2003 through announced 2026 releases; seven standalone DVD/Blu-ray entries excluded.",
  counts: {
    official_audio_entries: expectedUrls.size,
    normalized_releases: releaseSlugs.size,
    track_positions: sorted.length,
    songs: songSlugs.size,
    versions: versionSlugs.size,
    version_relations: relationKeys.size,
  },
  exclusions: [
    "Seven standalone DVD/Blu-ray Discography entries are live video products and are not mixed into the audio release/song catalog.",
    "Video bonus discs packaged with audio releases are excluded from release_tracks.",
  ],
  incomplete_official_metadata: [
    {
      release_slug: "a-certain-scientific-railgun-music-chronicles-wms-edition",
      issue: "The official product description confirms a six-track live bonus CD but does not publish its track titles or order. The known 30-track core program is present; the undisclosed bonus positions are not invented.",
      source_url: "https://wmg.jp/fripside/discography/31607/",
    },
    ...unique(uncertainties.map((item) => `${item.version_slug}: ${item.reason}`)),
  ],
};

await mkdir(resolve(paths.output, ".."), { recursive: true });
await mkdir(resolve(paths.report, ".."), { recursive: true });
await writeFile(paths.output, `${headers.join(",")}\n${sorted.map((record) => headers.map((header) => csv(record[header])).join(",")).join("\n")}\n`, "utf8");
await writeFile(paths.emptySetlists, "event_slug,performance_label,setlist_title,completeness,confidence,position,section,display_title,song_slug,song_title,song_aliases,song_first_release_date,original_artist,version_slug,version_title,version_label,artist_credit,medley_group,source_url,setlist_notes,song_notes,entry_notes\n", "utf8");
await writeFile(paths.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`已生成 ${paths.output}`);
console.log(`发行物 ${releaseSlugs.size}；曲目位置 ${sorted.length}；歌曲 ${songSlugs.size}；版本 ${versionSlugs.size}；版本关系 ${relationKeys.size}。`);
console.log(`报告：${paths.report}`);
