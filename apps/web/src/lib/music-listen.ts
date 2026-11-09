import type { ReleaseType, SongReleaseAppearance, StreamingProvider } from "@frip-fan/core";

/** One selectable thing to play: an album, or one recording of a song. */
export interface ListenSource {
  key: string;
  label: string;
  /** Short context shown under the player, e.g. the release a track comes from. */
  caption?: string;
  captionHref?: string;
  apple?: { embed: string; page: string };
  youtube?: { embed: string; page: string };
}

const APPLE_EMBED = "https://embed.music.apple.com";
const STOREFRONT = /^[a-z]{2}$/;
const NUMERIC_ID = /^\d{1,20}$/;
const YOUTUBE_ID = /^[\w-]{11}$/;

export function appleMusicLinks(storefront: string | null | undefined, albumId: string, trackId?: string | null) {
  const store = storefront && STOREFRONT.test(storefront) ? storefront : "jp";
  if (!NUMERIC_ID.test(albumId) || (trackId && !NUMERIC_ID.test(trackId))) return undefined;
  const query = trackId ? `?i=${trackId}` : "";
  return {
    // The site is dark; the embed otherwise follows the viewer's system theme.
    embed: `${APPLE_EMBED}/${store}/album/${albumId}${query ? `${query}&` : "?"}theme=dark`,
    page: `https://music.apple.com/${store}/album/${albumId}${query}`,
  };
}

export function youtubeLinks(videoId: string | null | undefined) {
  if (!videoId || !YOUTUBE_ID.test(videoId)) return undefined;
  return {
    embed: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&playsinline=1`,
    page: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

const typeRank: Record<ReleaseType, number> = { single: 0, album: 1, ep: 2, compilation: 3, video: 4, other: 5 };

/**
 * The recording to play for a version: the earliest release that has it on a
 * streaming platform, preferring singles and albums over compilations on the same day.
 */
export function pickPlayableAppearance(appearances: SongReleaseAppearance[]): SongReleaseAppearance | undefined {
  return appearances
    .filter((item) => (item.apple_music_album_id && item.apple_music_track_id) || item.youtube_video_id)
    .sort((a, b) => (a.release_date ?? "9999").localeCompare(b.release_date ?? "9999")
      || typeRank[a.release_type] - typeRank[b.release_type]
      || Number(!a.apple_music_track_id) - Number(!b.apple_music_track_id))[0];
}

export function appearanceSource(key: string, label: string, appearance: SongReleaseAppearance, caption: string): ListenSource {
  return {
    key,
    label,
    caption,
    captionHref: `/music/releases/${encodeURIComponent(appearance.release_slug)}`,
    apple: appearance.apple_music_album_id && appearance.apple_music_track_id
      ? appleMusicLinks(appearance.apple_music_storefront, appearance.apple_music_album_id, appearance.apple_music_track_id)
      : undefined,
    youtube: youtubeLinks(appearance.youtube_video_id),
  };
}

export const providerNames: Record<StreamingProvider, string> = { apple_music: "Apple Music", youtube: "YouTube" };
