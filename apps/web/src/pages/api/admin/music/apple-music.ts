import { assertScope, ServiceError } from "@frip-fan/core";
import type { APIRoute } from "astro";

// Admin-only proxy to the public iTunes Search API (JP storefront), used by the
// release editor to find an album and fill in its track ids.
//   GET ?term=<text>   → album candidates
//   GET ?album=<id>    → one album with its tracks
const STOREFRONT = "jp";

async function itunes(path: string, params: Record<string, string>) {
  const url = new URL(`https://itunes.apple.com/${path}`);
  for (const [key, value] of Object.entries({ country: STOREFRONT, ...params })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new ServiceError("apple_unavailable", `Apple Music 查询失败（HTTP ${response.status}），请稍后再试`, 502);
  return ((await response.json()) as { results?: Array<Record<string, unknown>> }).results ?? [];
}

const album = (item: Record<string, unknown>) => ({
  id: String(item.collectionId),
  name: String(item.collectionName ?? ""),
  artist: String(item.artistName ?? ""),
  release_date: String(item.releaseDate ?? "").slice(0, 10),
  track_count: Number(item.trackCount ?? 0),
  artwork: typeof item.artworkUrl100 === "string" ? item.artworkUrl100 : null,
  url: typeof item.collectionViewUrl === "string" ? item.collectionViewUrl.replace(/[?&]uo=\d+/, "") : null,
});

export const GET: APIRoute = async ({ url, locals }) => {
  try {
    assertScope(locals.actor!, "music:write");
    const albumId = url.searchParams.get("album")?.trim();
    const term = url.searchParams.get("term")?.trim().slice(0, 200);
    if (albumId) {
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
      return Response.json({ album: album(collection), tracks }, { headers: { "cache-control": "private, max-age=300" } });
    }
    if (!term) throw new ServiceError("invalid_request", "请输入搜索词", 400);
    // Searching with the artist name keeps karaoke and cover releases from crowding out the original.
    const results = await itunes("search", { term: /fripside/i.test(term) ? term : `fripSide ${term}`, entity: "album", limit: "25" });
    return Response.json({ albums: results.filter((item) => item.wrapperType === "collection").map(album) }, { headers: { "cache-control": "private, max-age=300" } });
  } catch (error) {
    const status = error instanceof ServiceError ? error.status : 500;
    const message = error instanceof Error ? error.message : "查询失败";
    return Response.json({ error: { message } }, { status });
  }
};
