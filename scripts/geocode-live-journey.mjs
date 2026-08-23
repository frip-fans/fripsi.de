import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const INPUT_PATH = resolve(process.argv[2] || ".cache/research/live-journey-venues.json");
const CACHE_PATH = resolve(process.argv[3] || ".cache/research/nominatim-live-journey.json");
const SQL_PATH = resolve("data/normalized/live-journey-coordinates.sql");
const REPORT_PATH = resolve("data/reports/live-journey-geocoding.json");
const USER_AGENT = "fripsi.de-live-journey/1.0 (+https://fripsi.de/about)";
const REQUEST_INTERVAL_MS = 1100;

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const normalized = (value) => String(value ?? "")
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu, "");

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function cacheKey(kind, id) {
  return `${kind}:${id}`;
}

async function searchNominatim(query, countryCode) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("accept-language", "ja,en");
  if (countryCode) url.searchParams.set("countrycodes", countryCode.toLowerCase());
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Nominatim ${response.status} for ${query}`);
  const value = await response.json();
  if (!Array.isArray(value)) throw new Error(`Unexpected Nominatim response for ${query}`);
  return value;
}

function candidateNames(candidate) {
  return [candidate.name, candidate.display_name, ...Object.values(candidate.namedetails ?? {})]
    .map(normalized).filter(Boolean);
}

function nominatimCountryCode(countryCode) {
  return countryCode === "HK" ? "CN" : countryCode;
}

function countryMatches(expected, actual) {
  return expected === actual || (expected === "HK" && actual === "CN");
}

function venueScore(venue, candidate) {
  const names = candidateNames(candidate);
  const venueName = normalized(venue.canonical_name);
  const areaName = normalized(venue.area_name);
  const candidateCountry = String(candidate.address?.country_code ?? "").toUpperCase();
  let score = Number(candidate.importance ?? 0);
  if (countryMatches(venue.country_code, candidateCountry)) score += 3;
  if (names.some((name) => name === venueName)) score += 8;
  else if (venueName.length >= 4 && names.some((name) => name.includes(venueName) || venueName.includes(name))) score += 5;
  if (areaName) score += normalized(candidate.display_name).includes(areaName) ? 3 : -10;
  if (["amenity", "tourism", "leisure", "building", "shop", "place"].includes(candidate.category)) score += 1;
  return score;
}

function venueNameMatches(venue, candidate) {
  const venueName = normalized(venue.canonical_name);
  return candidateNames(candidate).some((name) => name === venueName
    || (Math.min(name.length, venueName.length) >= 4 && (name.includes(venueName) || venueName.includes(name))));
}

function chooseVenueCandidate(venue, candidates) {
  const ranked = candidates.filter((candidate) => venueNameMatches(venue, candidate))
    .map((candidate) => ({ candidate, score: venueScore(venue, candidate) }))
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.score >= 5 ? ranked[0] : null;
}

function chooseAreaCandidate(area, candidates) {
  const matching = candidates.filter((candidate) => countryMatches(
    area.country_code, String(candidate.address?.country_code ?? "").toUpperCase()));
  return matching[0] ?? candidates[0] ?? null;
}

function coordinatePrecision(candidate) {
  if (["house", "building", "stadium", "theatre", "arts_centre", "music_venue"].includes(candidate.type)) return "building";
  return "site";
}

await mkdir(resolve(".cache/research"), { recursive: true });
await mkdir(resolve("data/normalized"), { recursive: true });
await mkdir(resolve("data/reports"), { recursive: true });

const input = await readJson(INPUT_PATH, null);
if (!input?.rows || !Array.isArray(input.rows)) throw new Error(`Invalid venue input: ${INPUT_PATH}`);
const venues = input.rows;
const areas = [...new Map(venues
  .filter((venue) => venue.administrative_area_id && venue.area_name && venue.country_code)
  .map((venue) => [venue.administrative_area_id, {
    id: venue.administrative_area_id,
    name: venue.area_name,
    country_code: venue.country_code,
  }])).values()];
const cache = await readJson(CACHE_PATH, { version: 1, results: {} });
let lastRequestAt = 0;

async function cachedSearch(kind, id, query, countryCode) {
  const key = cacheKey(kind, id);
  if (cache.results[key]?.query === query && cache.results[key]?.country_code === countryCode) return cache.results[key];
  const wait = REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  const candidates = await searchNominatim(query, countryCode);
  lastRequestAt = Date.now();
  cache.results[key] = { query, country_code: countryCode, fetched_at: new Date().toISOString(), candidates };
  await writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  return cache.results[key];
}

const areaResults = [];
for (const [index, area] of areas.entries()) {
  const query = area.country_code === "HK" ? "Hong Kong" : `${area.name}, ${area.country_code}`;
  const result = await cachedSearch("area", area.id, query, nominatimCountryCode(area.country_code));
  const selected = chooseAreaCandidate(area, result.candidates);
  areaResults.push({ ...area, query: result.query, selected });
  console.log(`area ${index + 1}/${areas.length}: ${area.name} -> ${selected?.display_name ?? "unresolved"}`);
}

const venueResults = [];
for (const [index, venue] of venues.entries()) {
  const query = [venue.canonical_name, venue.area_name, venue.country_code].filter(Boolean).join(", ");
  const result = await cachedSearch("venue", venue.id, query, nominatimCountryCode(venue.country_code));
  const selected = chooseVenueCandidate(venue, result.candidates);
  venueResults.push({ ...venue, query: result.query, selected });
  console.log(`venue ${index + 1}/${venues.length}: ${venue.canonical_name} -> ${selected?.candidate.display_name ?? "area fallback"}`);
}

// Reuse a matched site's coordinates for room/floor spelling variants in the
// same administrative area (for example Makuhari Messe hall variants).
for (const venue of venueResults.filter((item) => !item.selected)) {
  const name = normalized(venue.canonical_name);
  const related = venueResults
    .filter((candidate) => candidate.selected && candidate.administrative_area_id === venue.administrative_area_id)
    .map((candidate) => ({ candidate, name: normalized(candidate.canonical_name) }))
    .filter((candidate) => Math.min(name.length, candidate.name.length) >= 5
      && (name.includes(candidate.name) || candidate.name.includes(name)))
    .sort((left, right) => right.name.length - left.name.length)[0]?.candidate;
  if (related?.selected) {
    venue.selected = {
      candidate: related.selected.candidate,
      score: related.selected.score,
      derived_from: related.id,
    };
  }
}

const generatedAt = new Date().toISOString();
const statements = [
  "PRAGMA foreign_keys = ON;",
  "-- Generated by scripts/geocode-live-journey.mjs from cached Nominatim results.",
  "-- Automated coordinates are intentionally not marked as human verified.",
];

for (const area of areaResults) {
  if (!area.selected) continue;
  statements.push(`UPDATE administrative_areas SET
  latitude = ${Number(area.selected.lat)}, longitude = ${Number(area.selected.lon)},
  coordinate_source = ${sql(`osm-nominatim:${area.selected.osm_type}:${area.selected.osm_id}`)},
  coordinates_verified_at = NULL
WHERE id = ${sql(area.id)};`);
}

for (const venue of venueResults) {
  if (!venue.selected) continue;
  const candidate = venue.selected.candidate;
  const coordinateSource = venue.selected.derived_from
    ? `derived-venue:${venue.selected.derived_from}`
    : `osm-nominatim:${candidate.osm_type}:${candidate.osm_id}`;
  statements.push(`UPDATE venues SET
  latitude = ${Number(candidate.lat)}, longitude = ${Number(candidate.lon)},
  coordinate_precision = ${sql(coordinatePrecision(candidate))},
  coordinate_source = ${sql(coordinateSource)},
  coordinates_verified_at = NULL, updated_at = ${sql(generatedAt)}
WHERE id = ${sql(venue.id)};`);
  if (!venue.selected.derived_from && candidate.osm_id && candidate.osm_type) {
    statements.push(`INSERT OR IGNORE INTO venue_external_ids
  (venue_id, provider, external_id, external_type, checked_at)
SELECT ${sql(venue.id)}, 'osm', ${sql(candidate.osm_id)}, ${sql(candidate.osm_type)}, ${sql(generatedAt)}
WHERE EXISTS (SELECT 1 FROM venues WHERE id = ${sql(venue.id)});`);
  }
}

const report = {
  generated_at: generatedAt,
  policy: {
    service: "https://nominatim.openstreetmap.org",
    request_interval_ms: REQUEST_INTERVAL_MS,
    single_threaded: true,
    cached: true,
    user_agent: USER_AGENT,
  },
  summary: {
    venues: venues.length,
    venue_coordinates: venueResults.filter((venue) => venue.selected).length,
    venue_area_fallbacks: venueResults.filter((venue) => !venue.selected && venue.administrative_area_id).length,
    unresolved_without_area: venueResults.filter((venue) => !venue.selected && !venue.administrative_area_id).length,
    areas: areas.length,
    area_coordinates: areaResults.filter((area) => area.selected).length,
  },
  unresolved_venues: venueResults.filter((venue) => !venue.selected).map((venue) => ({
    id: venue.id, canonical_name: venue.canonical_name, area_name: venue.area_name,
    country_code: venue.country_code, event_count: venue.event_count, query: venue.query,
  })),
  selected_venues: venueResults.filter((venue) => venue.selected).map((venue) => ({
    id: venue.id, canonical_name: venue.canonical_name, area_name: venue.area_name,
    country_code: venue.country_code, event_count: venue.event_count, query: venue.query,
    score: venue.selected.score, display_name: venue.selected.candidate.display_name,
    latitude: Number(venue.selected.candidate.lat), longitude: Number(venue.selected.candidate.lon),
    osm_type: venue.selected.candidate.osm_type, osm_id: venue.selected.candidate.osm_id,
    derived_from: venue.selected.derived_from ?? null,
  })),
};

await writeFile(SQL_PATH, `${statements.join("\n\n")}\n`, "utf8");
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report.summary, null, 2));
console.log(`SQL: ${SQL_PATH}`);
console.log(`Report: ${REPORT_PATH}`);
