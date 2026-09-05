import { ServiceError } from "./utils";

export const COVER_PATH_PATTERN = /^\/media\/covers\/[a-f0-9]{64}\.(jpg|png|webp|gif)$/;
export const MAX_COVER_BYTES = 8 * 1024 * 1024;

export function isOfficialCoverUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === "https://fripside.net" && !url.username && !url.password
      && url.pathname.startsWith("/s3/skiyaki/uploads/");
  } catch { return false; }
}

export function coverImageType(bytes: Uint8Array): { extension: string; contentType: string } {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: "jpg", contentType: "image/jpeg" };
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return { extension: "png", contentType: "image/png" };
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { extension: "webp", contentType: "image/webp" };
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return { extension: "gif", contentType: "image/gif" };
  throw new ServiceError("invalid_cover_image", "封面必须是 JPEG、PNG、WebP 或 GIF 图片", 400);
}

export async function downloadOfficialCover(value: string, fetcher: typeof fetch = fetch) {
  let url = value.trim();
  const signal = AbortSignal.timeout(20_000);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!isOfficialCoverUrl(url)) throw new ServiceError("invalid_cover_url", "封面须使用 fripSide 官网图片地址", 400);
    const response = await fetcher(url, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) break;
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new ServiceError("cover_download_failed", "无法下载官网封面，请检查图片链接", 502);
    }
    if (Number(response.headers.get("content-length")) > MAX_COVER_BYTES) {
      await response.body.cancel();
      throw new ServiceError("cover_too_large", "封面不能超过 8 MB", 400);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > MAX_COVER_BYTES) throw new ServiceError("cover_too_large", "封面不能超过 8 MB", 400);
        chunks.push(chunk);
      }
    } catch (error) { await reader.cancel(); throw error; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const type = coverImageType(bytes);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const key = `covers/${hash}.${type.extension}`;
    return { bytes, key, cover_url: `/media/${key}`, original_url: url, ...type };
  }
  throw new ServiceError("cover_download_failed", "官网封面重定向过多", 502);
}

export async function importOfficialCover(bucket: R2Bucket, url: string, sourceUrl: string): Promise<string> {
  const image = await downloadOfficialCover(url);
  if (!await bucket.head(image.key)) {
    await bucket.put(image.key, image.bytes, {
      httpMetadata: { contentType: image.contentType, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { original_url: image.original_url, source_url: sourceUrl },
    });
  }
  return image.cover_url;
}
