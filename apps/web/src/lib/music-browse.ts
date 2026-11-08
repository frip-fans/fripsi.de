import { countSetlists, listSetlists, listSongCatalog, listReleases, type SetlistSummary, type SongBrowseSummary, type ReleaseSummary } from "@frip-fan/core";
import { releaseTypeLabels } from "./music";

export type MusicBrowseKind = "lives" | "songs" | "releases";
export const MUSIC_BATCH_SIZE = 6;
export const musicSorts = {
  lives: ["desc", "asc"],
  songs: ["live-desc", "live-asc", "title-asc", "title-desc", "release-desc", "release-asc"],
  releases: ["date-desc", "date-asc", "title-asc", "title-desc"],
} as const;

export function parseMusicBrowse(kind: MusicBrowseKind, params: URLSearchParams) {
  const requestedSort = params.get("sort") ?? "";
  const sort = (musicSorts[kind] as readonly string[]).includes(requestedSort) ? requestedSort : musicSorts[kind][0];
  const requestedYear = params.get("year") ?? "";
  const classification = params.get("classification") ?? "";
  const type = params.get("type") ?? "";
  const requestedPage = params.get("page") ?? "1";
  return {
    batch: kind === "releases" && params.get("batch") === "8" ? 8 : MUSIC_BATCH_SIZE,
    query: (params.get("q") ?? "").trim().slice(0, 200),
    year: kind === "lives" && /^\d{4}$/.test(requestedYear) ? requestedYear : "",
    classification: kind === "lives" && ["专场", "拼盘"].includes(classification) ? classification : "",
    type: kind === "releases" && Object.hasOwn(releaseTypeLabels, type) ? type : "",
    sort,
    page: /^\d+$/.test(requestedPage) ? Math.min(80, Math.max(1, Number(requestedPage))) : 1,
  };
}

export async function getMusicBrowseResults(db: D1Database, kind: MusicBrowseKind, params: URLSearchParams, append = false) {
  const input = parseMusicBrowse(kind, params);
  const offset = append ? (input.page - 1) * input.batch : 0;
  const limit = append ? input.batch : input.page * input.batch;
  let lives: SetlistSummary[] = [];
  let songs: SongBrowseSummary[] = [];
  let releases: ReleaseSummary[] = [];
  let total = 0;
  if (kind === "lives") {
    const filters = { query: input.query || undefined, year: input.year || undefined, classification: input.classification || undefined, order: input.sort as "asc" | "desc" };
    [total, lives] = await Promise.all([countSetlists(db, filters), listSetlists(db, { ...filters, offset, limit })]);
  } else if (kind === "songs") {
    const needle = input.query.toLocaleLowerCase();
    const filtered = (await listSongCatalog(db)).filter(song => !needle || song.search_text.toLocaleLowerCase().includes(needle));
    filtered.sort((a, b) => {
      if (input.sort === "live-asc") return a.show_count - b.show_count || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
      if (input.sort.startsWith("title-")) return (a.title.localeCompare(b.title) || a.id.localeCompare(b.id)) * (input.sort === "title-asc" ? 1 : -1);
      if (input.sort.startsWith("release-")) return compareDates(a.first_release_date, b.first_release_date, a.title, b.title, input.sort === "release-asc") || a.id.localeCompare(b.id);
      return b.show_count - a.show_count || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
    total = filtered.length;
    songs = filtered.slice(offset, offset + limit);
  } else {
    const needle = input.query.toLocaleLowerCase();
    const filtered = (await listReleases(db, { limit: 500 }))
      .filter(release => !input.type || release.release_type === input.type)
      .filter(release => !needle || [release.title, release.catalog_number, release.edition].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle));
    filtered.sort((a, b) => input.sort.startsWith("title-")
      ? (a.title.localeCompare(b.title) || a.id.localeCompare(b.id)) * (input.sort === "title-asc" ? 1 : -1)
      : compareDates(a.release_date, b.release_date, a.title, b.title, input.sort === "date-asc") || a.id.localeCompare(b.id));
    total = filtered.length;
    releases = filtered.slice(offset, offset + limit);
  }
  const shown = Math.min(total, offset + lives.length + songs.length + releases.length);
  return { lives, songs, releases, total, shown, page: input.page, batch: input.batch, hasMore: shown < total };
}

function compareDates(left: string | null, right: string | null, leftTitle: string, rightTitle: string, ascending: boolean) {
  if (!left && !right) return leftTitle.localeCompare(rightTitle);
  if (!left) return 1;
  if (!right) return -1;
  const comparison = left.localeCompare(right);
  return comparison ? comparison * (ascending ? 1 : -1) : leftTitle.localeCompare(rightTitle);
}
