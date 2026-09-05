import { COVER_PATH_PATTERN } from "@frip-fan/core";

export async function coverResponse(request: Request, file: string | undefined, bucket: R2Bucket): Promise<Response> {
  if (!file || !COVER_PATH_PATTERN.test(`/media/covers/${file}`)) return new Response(null, { status: 404 });
  const key = `covers/${file}`;
  const bodyObject = request.method === "HEAD" ? null : await bucket.get(key);
  const object = request.method === "HEAD" ? await bucket.head(key) : bodyObject;
  if (!object) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  const headers = new Headers({ "cache-control": "public, max-age=31536000, immutable", etag: object.httpEtag, "x-content-type-options": "nosniff" });
  const type = file.endsWith(".jpg") ? "image/jpeg" : `image/${file.split(".").at(-1)}`;
  headers.set("content-type", type);
  const tags = request.headers.get("if-none-match")?.split(",").map((tag) => tag.trim().replace(/^W\//, ""));
  if (tags?.includes("*") || tags?.includes(object.httpEtag)) {
    await bodyObject?.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(bodyObject?.body ?? null, { headers });
}
