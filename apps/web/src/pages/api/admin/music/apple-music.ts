import { assertScope, getAppleMusicAlbum, searchAppleMusicAlbums, ServiceError } from "@frip-fan/core";
import type { APIRoute } from "astro";

// Admin-only lookup used by the release editor to find an album and fill in its track ids.
//   GET ?term=<text>   → album candidates
//   GET ?album=<id>    → one album with its tracks
export const GET: APIRoute = async ({ url, locals }) => {
  try {
    assertScope(locals.actor!, "music:write");
    const albumId = url.searchParams.get("album")?.trim();
    const headers = { "cache-control": "private, max-age=300" };
    if (albumId) return Response.json(await getAppleMusicAlbum(albumId), { headers });
    return Response.json({ albums: await searchAppleMusicAlbums(url.searchParams.get("term") ?? "") }, { headers });
  } catch (error) {
    const status = error instanceof ServiceError ? error.status : 500;
    const message = error instanceof Error ? error.message : "查询失败";
    return Response.json({ error: { message } }, { status });
  }
};
