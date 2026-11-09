// Parsing and matching helpers for streaming platform ids. Browser-safe: no
// database or Node imports, so admin client scripts can use them too.

export interface AppleMusicRef {
  storefront: string;
  albumId: string | null;
  trackId: string | null;
}

const NUMERIC_ID = /^\d{1,20}$/;
const YOUTUBE_ID = /^[\w-]{11}$/;

/**
 * Accepts a bare numeric id or an Apple Music / iTunes URL such as
 * https://music.apple.com/jp/album/name/1804662303?i=1804662304.
 * A bare id is taken as a track id when `bare` is "track", otherwise an album id.
 */
export function parseAppleMusicRef(value: string | null | undefined, bare: "album" | "track" = "album"): AppleMusicRef | null {
  const input = value?.trim();
  if (!input) return null;
  if (NUMERIC_ID.test(input)) return { storefront: "jp", albumId: bare === "album" ? input : null, trackId: bare === "track" ? input : null };
  let url: URL;
  try { url = new URL(input); } catch { return null; }
  if (!/(^|\.)apple\.com$/.test(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const storefront = /^[a-z]{2}$/.test(parts[0] ?? "") ? parts[0] : "jp";
  const last = parts.at(-1) ?? "";
  const kind = parts.find((part) => part === "album" || part === "song");
  const pathId = NUMERIC_ID.test(last) ? last : last.replace(/^id/, "");
  const queryTrack = url.searchParams.get("i");
  if (kind === "song") return NUMERIC_ID.test(pathId) ? { storefront, albumId: null, trackId: pathId } : null;
  const albumId = NUMERIC_ID.test(pathId) ? pathId : null;
  const trackId = queryTrack && NUMERIC_ID.test(queryTrack) ? queryTrack : null;
  return albumId || trackId ? { storefront, albumId, trackId } : null;
}

/** Accepts a bare video id or a youtube.com / youtu.be / music.youtube.com URL. */
export function parseYouTubeId(value: string | null | undefined): string | null {
  const input = value?.trim();
  if (!input) return null;
  if (YOUTUBE_ID.test(input)) return input;
  let url: URL;
  try { url = new URL(input); } catch { return null; }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1] ?? null;
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** Comparable form of a title: width-folded, lowercased, punctuation and edition suffixes removed. */
export function normalizeCatalogTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+-\s+(single|ep)$/u, "")
    .replace(/[（(\[［][^（）()\[\]［］]*(盤|edition|商品|version|オープニング|エンディング|主題歌|テーマ)[^（）()\[\]［］]*[）)\]］]/gu, "")
    .replace(/[\s\-‐−–—~〜:：／/・☆!！?？'’"“”.,、。×x]/gu, "");
}

export interface MatchableLocalTrack { disc_number: number; track_number: number; display_title: string }
export interface MatchableAppleTrack { trackId: number | string; discNumber: number; trackNumber: number; trackName: string }

/**
 * Pairs local tracks with Apple tracks, strongest evidence first: same position
 * with an agreeing title, then a title unique on the album, then position alone
 * when both lists have the same length. Each Apple track is used at most once.
 * Returns one Apple track id (or null) per local track.
 */
export function matchAppleTracks(local: MatchableLocalTrack[], apple: MatchableAppleTrack[]): Array<string | null> {
  const titleOf = new Map(apple.map((song) => [song, normalizeCatalogTitle(song.trackName)]));
  const used = new Set<MatchableAppleTrack>();
  const result: Array<MatchableAppleTrack | null> = local.map(() => null);
  const positional = (track: MatchableLocalTrack) => apple.find((song) => song.discNumber === track.disc_number && song.trackNumber === track.track_number);
  const claim = (index: number, song: MatchableAppleTrack | undefined | null) => {
    if (!song || used.has(song) || result[index]) return;
    result[index] = song;
    used.add(song);
  };
  local.forEach((track, index) => {
    const song = positional(track);
    if (song && titleOf.get(song) === normalizeCatalogTitle(track.display_title)) claim(index, song);
  });
  local.forEach((track, index) => {
    const titled = apple.filter((song) => titleOf.get(song) === normalizeCatalogTitle(track.display_title));
    if (titled.length === 1) claim(index, titled[0]);
  });
  if (apple.length === local.length) local.forEach((track, index) => claim(index, positional(track)));
  return result.map((song) => (song ? String(song.trackId) : null));
}
