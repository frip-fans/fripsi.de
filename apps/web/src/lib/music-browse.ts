import { matchReleaseIds, matchSongIds, songPhasesFromMask, countSetlists, getSetlistHighlights, listSetlists, listSetlistYears, listSongCatalog, type SetlistHighlights, listReleases, type SetlistSummary, type SongBrowseSummary, type ReleaseSummary } from "@frip-fan/core";
import { releaseTypeLabels } from "./music";
import { MUSIC_BATCH_SIZE, MUSIC_SONG_BATCH_SIZE, MUSIC_WIDE_RELEASE_BATCH_SIZE, musicBatchSize } from "./music-batch";
import { rankByShows } from "./song-ranking";

export type MusicBrowseKind = "lives" | "songs" | "releases";
export { MUSIC_BATCH_SIZE, MUSIC_SONG_BATCH_SIZE, MUSIC_WIDE_RELEASE_BATCH_SIZE };
export const musicSorts = {
  lives: ["desc", "asc"],
  songs: ["live-desc", "live-asc", "title-asc", "title-desc", "release-desc", "release-asc"],
  releases: ["date-desc", "date-asc", "title-asc", "title-desc"],
} as const;

export const liveClassifications = ["专场", "拼盘"] as const;
export const songPhaseValues = ["1", "2", "3"] as const;
const MAX_MULTI_VALUES = 40;

/** Read a repeatable query parameter, keeping valid unique values in request order. */
function multiValues(params: URLSearchParams, key: string, valid: (value: string) => boolean): string[] {
  return [...new Set(params.getAll(key).map(value => value.trim()).filter(valid))].slice(0, MAX_MULTI_VALUES);
}

export function parseMusicBrowse(kind: MusicBrowseKind, params: URLSearchParams) {
  const requestedSort = params.get("sort") ?? "";
  const sort = (musicSorts[kind] as readonly string[]).includes(requestedSort) ? requestedSort : musicSorts[kind][0];
  const requestedPage = params.get("page") ?? "1";
  return {
    batch: musicBatchSize(kind, params.get("batch") === String(MUSIC_WIDE_RELEASE_BATCH_SIZE)),
    query: (params.get("q") ?? "").trim().slice(0, 200),
    years: kind === "lives" ? multiValues(params, "year", value => /^\d{4}$/.test(value)) : [],
    classifications: kind === "lives" ? multiValues(params, "classification", value => (liveClassifications as readonly string[]).includes(value)) : [],
    types: kind === "releases" ? multiValues(params, "type", value => Object.hasOwn(releaseTypeLabels, value)) : [],
    phases: kind === "songs" ? multiValues(params, "phase", value => (songPhaseValues as readonly string[]).includes(value)) : [],
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
  let yearCounts: Record<string, number> = {};
  const highlights: Record<string, SetlistHighlights> = {};
  // Song ranking: ranks are computed within the selected phases before the text search narrows the list.
  let ranks: Record<string, number> = {};
  let maxShows = 0;
  if (kind === "lives") {
    const filters = { query: input.query || undefined, years: input.years, classifications: input.classifications, order: input.sort as "asc" | "desc" };
    let years: Array<{ year: string; count: number }>;
    let archive: Map<string, SetlistHighlights>;
    [total, lives, years, archive] = await Promise.all([countSetlists(db, filters), listSetlists(db, { ...filters, offset, limit }), listSetlistYears(db, filters), getSetlistHighlights(db)]);
    yearCounts = Object.fromEntries(years.map(item => [item.year, item.count]));
    for (const setlist of lives) { const item = archive.get(setlist.id); if (item) highlights[setlist.id] = item; }
  } else if (kind === "songs") {
    const [catalog, matched] = await Promise.all([listSongCatalog(db), input.query ? matchSongIds(db, input.query, "public") : null]);
    const matchedIds = matched && new Set(matched);
    const scope = catalog.filter(song => !input.phases.length || songPhasesFromMask(song.phase_mask).some(phase => input.phases.includes(String(phase))));
    ranks = Object.fromEntries(rankByShows(scope));
    maxShows = Math.max(0, ...scope.map(song => song.show_count));
    const filtered = scope.filter(song => !matchedIds || matchedIds.has(song.id));
    filtered.sort((a, b) => {
      if (input.sort === "live-asc") return a.show_count - b.show_count || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
      if (input.sort.startsWith("title-")) return (a.title.localeCompare(b.title) || a.id.localeCompare(b.id)) * (input.sort === "title-asc" ? 1 : -1);
      if (input.sort.startsWith("release-")) return compareDates(a.first_release_date, b.first_release_date, a.title, b.title, input.sort === "release-asc") || a.id.localeCompare(b.id);
      return b.show_count - a.show_count || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
    total = filtered.length;
    songs = filtered.slice(offset, offset + limit);
  } else {
    const [all, matched] = await Promise.all([listReleases(db, { limit: 500 }), input.query ? matchReleaseIds(db, input.query, "public") : null]);
    const matchedIds = matched && new Set(matched);
    const filtered = all
      .filter(release => !input.types.length || input.types.includes(release.release_type))
      .filter(release => !matchedIds || matchedIds.has(release.id));
    filtered.sort((a, b) => input.sort.startsWith("title-")
      ? (a.title.localeCompare(b.title) || a.id.localeCompare(b.id)) * (input.sort === "title-asc" ? 1 : -1)
      : compareDates(a.release_date, b.release_date, a.title, b.title, input.sort === "date-asc") || a.id.localeCompare(b.id));
    total = filtered.length;
    releases = filtered.slice(offset, offset + limit);
  }
  const shown = Math.min(total, offset + lives.length + songs.length + releases.length);
  return { lives, songs, releases, total, shown, yearCounts, highlights, ranks, maxShows, ranked: kind === "songs" && input.sort === "live-desc", page: input.page, batch: input.batch, hasMore: shown < total };
}

function compareDates(left: string | null, right: string | null, leftTitle: string, rightTitle: string, ascending: boolean) {
  if (!left && !right) return leftTitle.localeCompare(rightTitle);
  if (!left) return 1;
  if (!right) return -1;
  const comparison = left.localeCompare(right);
  return comparison ? comparison * (ascending ? 1 : -1) : leftTitle.localeCompare(rightTitle);
}
