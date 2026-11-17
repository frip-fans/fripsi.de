import { ServiceError } from "./utils";

// Lookups against the public iTunes Search API (JP storefront), used to find a release on
// Apple Music and fill in its album and track ids.
const STOREFRONT = "jp";

export interface AppleMusicAlbum {
  id: string;
  name: string;
  artist: string;
  release_date: string;
  track_count: number;
  artwork: string | null;
  url: string | null;
}

export interface AppleMusicTrack { trackId: string; discNumber: number; trackNumber: number; trackName: string }

async function itunes(path: string, params: Record<string, string>) {
  const url = new URL(`https://itunes.apple.com/${path}`);
  for (const [key, value] of Object.entries({ country: STOREFRONT, ...params })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new ServiceError("apple_unavailable", `Apple Music 查询失败（HTTP ${response.status}），请稍后再试`, 502);
  return ((await response.json()) as { results?: Array<Record<string, unknown>> }).results ?? [];
}

const album = (item: Record<string, unknown>): AppleMusicAlbum => ({
  id: String(item.collectionId),
  name: String(item.collectionName ?? ""),
  artist: String(item.artistName ?? ""),
  release_date: String(item.releaseDate ?? "").slice(0, 10),
  track_count: Number(item.trackCount ?? 0),
  artwork: typeof item.artworkUrl100 === "string" ? item.artworkUrl100 : null,
  url: typeof item.collectionViewUrl === "string" ? item.collectionViewUrl.replace(/[?&]uo=\d+/, "") : null,
});

export async function searchAppleMusicAlbums(term: string): Promise<AppleMusicAlbum[]> {
  const text = term.trim().slice(0, 200);
  if (!text) throw new ServiceError("invalid_request", "请输入搜索词", 400);
  // Searching with the artist name keeps karaoke and cover releases from crowding out the original.
  const results = await itunes("search", { term: /fripside/i.test(text) ? text : `fripSide ${text}`, entity: "album", limit: "25" });
  return results.filter((item) => item.wrapperType === "collection").map(album);
}

export async function getAppleMusicAlbum(albumId: string): Promise<{ album: AppleMusicAlbum; tracks: AppleMusicTrack[] }> {
  if (!/^\d{1,20}$/.test(albumId)) throw new ServiceError("invalid_request", "专辑 ID 应为数字", 400);
  const results = await itunes("lookup", { id: albumId, entity: "song" });
  const collection = results.find((item) => item.wrapperType === "collection");
  if (!collection) throw new ServiceError("not_found", "Apple Music 日区没有这个专辑", 404);
  const tracks = results.filter((item) => item.wrapperType === "track").map((item) => ({
    trackId: String(item.trackId),
    discNumber: Number(item.discNumber ?? 1),
    trackNumber: Number(item.trackNumber ?? 0),
    trackName: String(item.trackName ?? ""),
  }));
  return { album: album(collection), tracks };
}
