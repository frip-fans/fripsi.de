import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// A range such as WPZL-32314～5 and WPZL-32314/5 identifies the same product.
const catalogKey = (value) => value?.normalize("NFKC").toUpperCase().match(/[A-Z]+-?\d+/)?.[0].replace("-", "") ?? "";
export function selectCover(entry, catalogs) {
  const keys = new Set(catalogs.map(catalogKey).filter(Boolean));
  const editions = entry.editions.filter((edition) => edition.cover_url);
  const matches = editions.filter((edition) => keys.has(catalogKey(edition.catalog_number)));
  const selected = matches.find((edition) => /通常/.test(edition.title)) || matches[0];
  if (selected) return { cover_url: selected.cover_url, cover_edition: selected.title, match: "catalog_number" };
  // Never substitute another edition when catalog matching failed.
  if (editions.length && keys.size) return null;
  if (!entry.cover_url) return null;
  return { cover_url: entry.cover_url, cover_edition: null, match: "official_main_artwork" };
}
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
export function coverUpdateSql(record) {
  if (!/^\/media\/covers\/[a-f0-9]{64}\.(jpg|png|webp|gif)$/.test(record.cover_url)) throw new Error("Cover must be uploaded to R2 before generating SQL");
  const previous = record.original_url ? ` OR (cover_url = ${quote(record.original_url)} AND cover_source_url = ${quote(record.source_url)})` : "";
  return `UPDATE releases SET cover_url = ${quote(record.cover_url)}, cover_source_url = ${quote(record.source_url)}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = ${quote(record.release_slug)} AND release_date = ${quote(record.release_date)} AND ((cover_url IS NULL AND cover_source_url IS NULL)${previous}) AND EXISTS (SELECT 1 FROM catalog_sources WHERE subject_type = 'release' AND subject_id = releases.id AND url = ${quote(record.source_url)});`;
}

async function main() {
  const artwork = JSON.parse(await readFile("data/research/fripside-official-covers.json", "utf8"));
  const bySource = new Map(artwork.releases.map((entry) => [entry.source_url, entry]));
  const targets = [];
  for (const period of ["2003-2013", "2014-2020", "2021-2026"]) {
    const normalization = JSON.parse(await readFile(`data/research/discography-${period}-normalization.json`, "utf8"));
    const research = JSON.parse(await readFile(`data/research/discography-${period}.json`, "utf8"));
    for (const release of normalization.releases) {
      const entry = bySource.get(release.source_url);
      if (!entry) throw new Error(`Missing official cover research: ${release.source_url}`);
      const original = research.releases.find((item) => item.source_url === release.source_url);
      const groups = release.edition_groups ?? [{
        release_slug: release.release_slug,
        catalog_numbers: release.edition_normalization?.merge_same_audio_editions?.[0]?.catalog_numbers ?? original.editions.map((edition) => edition.catalog_number),
      }];
      for (const group of groups) targets.push({
        release_slug: group.normalized_release_slug ?? group.suggested_release_slug ?? group.release_slug,
        release_date: entry.release_date,
        source_url: entry.source_url,
        catalogs: group.catalog_numbers ?? group.editions.map((edition) => edition.catalog_number),
      });
    }
  }
  // This edition is explicitly added by build-complete-discography-import.mjs.
  const chronicles = targets.find((target) => target.release_slug === "a-certain-scientific-railgun-music-chronicles");
  if (chronicles) targets.push({ ...chronicles, release_slug: "a-certain-scientific-railgun-music-chronicles-wms-edition", catalogs: ["WPZL-60066/9"] });
  const matched = [], unmatched = [];
  for (const target of targets) {
    const cover = selectCover(bySource.get(target.source_url), target.catalogs);
    if (cover) matched.push({ ...target, ...cover });
    else unmatched.push(target);
  }
  await mkdir("data/reports", { recursive: true });
  await writeFile("data/reports/fripside-release-covers.json", JSON.stringify({ checked_at: artwork.checked_at, matched, unmatched }, null, 2) + "\n");
  console.log(`Matched ${matched.length} covers; ${unmatched.length} unmatched. Run import-release-covers-r2.ts to prepare and upload images before generating SQL.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
