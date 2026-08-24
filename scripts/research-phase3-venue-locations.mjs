import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const INPUT_PATH = resolve(".cache/research/live-journey-venues.json");
const EXISTING_COORDINATE_REPORT_PATH = resolve("data/reports/live-journey-geocoding.json");
const OUTPUT_PATH = resolve("data/reports/fripside-phase3-venue-location-candidates.json");
const SQL_PATH = resolve("data/normalized/fripside-phase3-venue-locations.sql");
const ROLLBACK_PATH = resolve(".cache/backups/frip-fan-prod-phase3-venue-locations-rollback.sql");
const writeSql = process.argv.includes("--write-sql");

const phase3VenueNames = new Set([
  "高松 Olive Hall",
  "東京建物 Brillia HALL 箕面",
  "LINE CUBE SHIBUYA（渋谷公会堂）",
  "マクファーソンスタジアム",
  "新宿LOFT",
  "Asue アリーナ大阪",
  "国立台湾大学総合体育館 1F",
  "大阪国際交流センター大ホール",
  "YES24 LIVE HALL",
  "パシフィコ横浜 国立大ホール",
  "豊洲PIT",
  "PENNY LANE 24",
  "水戸 LIGHT HOUSE",
  "club GRINDHOUSE",
  "ロームシアター京都 メインホール",
  "B.9 V2",
  "DRUM Be-7",
  "柏 PALOOZA",
  "Club-G",
  "GORILLA HALL OSAKA",
  "CRAZYMAMA KINGDOM",
  "松江 AZTiC canova",
  "YOKOHAMA BAY HALL",
  "GEILS",
  "RISING HALL SHUNAN",
  "ミュージック昭和SESSION",
  "Club SWINDLE",
  "四日市 CLUB ROOTS",
  "神戸 Harbor Studio",
  "松山 SALONKITTY",
  "X-pt",
  "高崎 Club JAMMERS",
  "武蔵野の森総合スポーツプラザ メインアリーナ",
  "Zepp Osaka Bayside",
  "Quarter",
  "盛岡 Club Change WAVE",
  "CHOP",
  "金沢 AZ",
  "米子 AZTiC laughs",
  "LAZARUS",
  "SENDAI CLUB JUNK BOX",
  "HEAVEN’S ROCK 宇都宮 VJ-2",
  "DRUM Be-1",
  "NEXS",
  "HEAVEN’S ROCK 熊谷 VJ-1",
  "甲府 KAZOO HALL",
  "LIVE ROXY SHIZUOKA",
  "KYOTO FANJ",
]);

const phase3ExistingCoordinateVenueNames = new Set([
  "さいたまスーパーアリーナ", "TACHIKAWA STAGE GARDEN", "Zepp Haneda TOKYO", "Zepp Shinjuku (TOKYO)",
  "名古屋 DIAMOND HALL", "日本武道館", "横浜アリーナ", "CAPARVO HALL", "CLUB #9", "CLUB CITTA'",
  "CLUB GATE", "DRUM Be-0", "KT Zepp Yokohama", "MAIRO", "NAGANO CLUB JUNK BOX", "NEVER LAND",
  "Reed", "TOKYO DOME CITY HALL", "U★STONE", "なんばHatch", "ぴあアリーナMM", "一宮市民会館",
  "六本木ヒルズアリーナ", "幕張メッセ 国際展示場 4～6ホール", "幕張メッセ 国際展示場ホール", "桜坂セントラル",
]);

const countryBounds = {
  HK: [22, 23, 113, 115],
  JP: [24, 46, 122, 146],
  KR: [33, 39, 124, 132],
  TW: [21, 26, 119, 123],
};

const queryOverrides = new Map([
  ["Asue アリーナ大阪", "大阪市港区田中3丁目1番40号"],
  ["HEAVEN’S ROCK 宇都宮 VJ-2", "HEAVEN'S ROCK Utsunomiya VJ-2, 宇都宮市宮園町5-33"],
  ["RISING HALL SHUNAN", "RISING HALL, 山口県周南市銀南街49"],
  ["大阪国際交流センター大ホール", "大阪市天王寺区上本町8丁目2番6号"],
  ["ロームシアター京都 メインホール", "ロームシアター京都, 京都市左京区岡崎最勝寺町13"],
  ["新宿LOFT", "新宿ロフト, 東京都新宿区歌舞伎町1-12-9"],
  ["東京建物 Brillia HALL 箕面", "箕面市立文化芸能劇場, 大阪府箕面市船場東3丁目10番1号"],
  ["松山 SALONKITTY", "愛媛県松山市河原町138"],
  ["盛岡 Club Change WAVE", "盛岡CLUB CHANGE WAVE, 岩手県盛岡市大通1丁目11-12"],
  ["金沢 AZ", "金沢AZ, 石川県金沢市鱗町107"],
]);

const decode = (value) => JSON.parse(`"${value.replaceAll('"', '\\"')}"`);
const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;

function parseCandidate(html) {
  const placeMatch = html.match(/\[\["(0x[^"]+:[^"]+)","((?:\\.|[^"])*)",\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\],"([^"]+)"\],"((?:\\.|[^"])*)",\[/);
  const addressMatch = html.match(/\[\["(0x[^"]+:[^"]+)","((?:\\.|[^"])*)",\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]\],"((?:\\.|[^"])*)",\[/);
  const match = placeMatch ?? addressMatch;
  if (!match) return null;
  return {
    google_hex_id: match[1],
    address_text: decode(match[2]),
    latitude: Number(match[3]),
    longitude: Number(match[4]),
    google_cid: placeMatch ? match[5] : null,
    matched_name: decode(placeMatch ? match[6] : match[5]),
  };
}

function withinCountryBounds(candidate, countryCode) {
  const bounds = countryBounds[countryCode];
  if (!bounds || !candidate) return false;
  return candidate.latitude >= bounds[0] && candidate.latitude <= bounds[1]
    && candidate.longitude >= bounds[2] && candidate.longitude <= bounds[3];
}

async function researchVenue(venue) {
  const query = queryOverrides.get(venue.canonical_name)
    ?? [venue.canonical_name, venue.area_name, venue.country_code, "live venue"].filter(Boolean).join(", ");
  const url = new URL("https://maps.google.com/maps");
  url.searchParams.set("q", query);
  url.searchParams.set("output", "embed");
  let candidate = null;
  let lastStatus = null;
  for (let attempt = 1; attempt <= 3 && !candidate; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        accept: "text/html",
        "accept-language": "ja,en;q=0.8",
        "user-agent": "fripsi.de venue research (+https://fripsi.de/about)",
      },
    });
    lastStatus = response.status;
    if (response.ok) candidate = parseCandidate(await response.text());
    if (!candidate && attempt < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, 350 * attempt));
  }
  if (lastStatus && lastStatus >= 400) throw new Error(`Google Maps ${lastStatus}`);
  return {
    ...venue,
    query,
    source_url: url.toString(),
    candidate,
    automatic_checks: {
      parsed: Boolean(candidate),
      within_country_bounds: withinCountryBounds(candidate, venue.country_code),
    },
  };
}

const [input, existingCoordinateReport] = await Promise.all([
  readFile(INPUT_PATH, "utf8").then(JSON.parse),
  readFile(EXISTING_COORDINATE_REPORT_PATH, "utf8").then(JSON.parse),
]);
const venues = input.rows.filter((venue) => phase3VenueNames.has(venue.canonical_name));
if (venues.length !== phase3VenueNames.size) {
  const found = new Set(venues.map((venue) => venue.canonical_name));
  const missing = [...phase3VenueNames].filter((name) => !found.has(name));
  throw new Error(`Expected ${phase3VenueNames.size} venues, found ${venues.length}; missing: ${missing.join(", ")}`);
}
const existingCoordinateAddresses = existingCoordinateReport.selected_venues
  .filter((venue) => phase3ExistingCoordinateVenueNames.has(venue.canonical_name));
if (existingCoordinateAddresses.length !== phase3ExistingCoordinateVenueNames.size) {
  throw new Error(`Expected ${phase3ExistingCoordinateVenueNames.size} existing-coordinate venues, found ${existingCoordinateAddresses.length}`);
}
const originalVenueById = new Map(input.rows.map((venue) => [venue.id, venue]));

const results = [];
const queue = [...venues];
const workers = Array.from({ length: 4 }, async () => {
  while (queue.length > 0) {
    const venue = queue.shift();
    try {
      const result = await researchVenue(venue);
      results.push(result);
      console.log(`${results.length}/${venues.length} ${venue.canonical_name} -> ${result.candidate?.matched_name ?? "unresolved"}`);
    } catch (error) {
      results.push({ ...venue, error: String(error?.message ?? error) });
      console.log(`${results.length}/${venues.length} ${venue.canonical_name} -> ERROR`);
    }
  }
});
await Promise.all(workers);
results.sort((left, right) => left.canonical_name.localeCompare(right.canonical_name, "ja"));

const generatedAt = new Date().toISOString();
const report = {
  generated_at: generatedAt,
  scope: "Physical LIVE events on or after 2022-04-24 whose venue lacked venue-level coordinates in production audit",
  source_policy: "Google Maps embed search candidates are research inputs only; every row requires manual review before production import.",
  review_status: writeSql ? "Manually reviewed for venue identity, street address, administrative area, and coordinate plausibility." : "Candidate research only; not approved for import.",
  summary: {
    venues: results.length,
    parsed: results.filter((result) => result.candidate).length,
    within_country_bounds: results.filter((result) => result.automatic_checks?.within_country_bounds).length,
    unresolved: results.filter((result) => !result.candidate).length,
    existing_coordinate_addresses: existingCoordinateAddresses.length,
  },
  venues: results,
  existing_coordinate_addresses: existingCoordinateAddresses,
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (writeSql) {
  const invalid = results.filter((result) => !result.candidate || !result.automatic_checks?.within_country_bounds);
  if (invalid.length > 0) throw new Error(`Refusing to write SQL: ${invalid.length} candidates failed validation`);
  const statements = [
    "PRAGMA foreign_keys = ON;",
    "-- Phase 3 physical LIVE venue completion generated from a manually reviewed candidate report.",
    "-- Updates are guarded so newly populated production coordinates are never overwritten.",
  ];
  const rollbackStatements = [
    "PRAGMA foreign_keys = ON;",
    "-- Targeted rollback for fripside-phase3-venue-locations.sql.",
    "-- Guards ensure later edits are not overwritten.",
  ];
  for (const result of results) {
    const candidate = result.candidate;
    statements.push(`UPDATE venues SET
  address_text = CASE WHEN address_text IS NULL OR trim(address_text) = '' THEN ${sql(candidate.address_text)} ELSE address_text END,
  latitude = ${candidate.latitude},
  longitude = ${candidate.longitude},
  coordinate_precision = 'building',
  coordinate_source = ${sql(`google-maps:${candidate.google_hex_id}`)},
  coordinates_verified_at = ${sql(generatedAt)},
  updated_at = ${sql(generatedAt)}
WHERE id = ${sql(result.id)} AND latitude IS NULL AND longitude IS NULL;`);
    statements.push(`INSERT OR IGNORE INTO venue_external_ids
  (venue_id, provider, external_id, external_type, checked_at)
SELECT ${sql(result.id)}, 'google', ${sql(candidate.google_hex_id)}, 'maps-hex-id', ${sql(generatedAt)}
WHERE EXISTS (SELECT 1 FROM venues WHERE id = ${sql(result.id)});`);
    rollbackStatements.push(`DELETE FROM venue_external_ids
WHERE venue_id = ${sql(result.id)} AND provider = 'google' AND external_id = ${sql(candidate.google_hex_id)};`);
    rollbackStatements.push(`UPDATE venues SET
  address_text = ${sql(result.address_text)},
  latitude = NULL,
  longitude = NULL,
  coordinate_precision = NULL,
  coordinate_source = NULL,
  coordinates_verified_at = NULL,
  updated_at = ${sql(generatedAt)}
WHERE id = ${sql(result.id)} AND coordinate_source = ${sql(`google-maps:${candidate.google_hex_id}`)};`);
  }
  for (const venue of existingCoordinateAddresses) {
    statements.push(`UPDATE venues SET
  address_text = ${sql(venue.display_name)},
  updated_at = ${sql(generatedAt)}
WHERE id = ${sql(venue.id)} AND (address_text IS NULL OR trim(address_text) = '');`);
    const original = originalVenueById.get(venue.id);
    rollbackStatements.push(`UPDATE venues SET
  address_text = ${sql(original?.address_text ?? null)},
  updated_at = ${sql(generatedAt)}
WHERE id = ${sql(venue.id)} AND address_text = ${sql(venue.display_name)};`);
  }
  await writeFile(SQL_PATH, `${statements.join("\n\n")}\n`, "utf8");
  await writeFile(ROLLBACK_PATH, `${rollbackStatements.join("\n\n")}\n`, "utf8");
}
console.log(JSON.stringify(report.summary, null, 2));
console.log(`Report: ${OUTPUT_PATH}`);
if (writeSql) console.log(`SQL: ${SQL_PATH}`);
if (writeSql) console.log(`Rollback: ${ROLLBACK_PATH}`);
