import { afterEach, describe, expect, it, vi } from "vitest";
import { COVER_PATH_PATTERN, downloadOfficialCover, importOfficialCover, MAX_COVER_BYTES } from "./release-media";

const url = "https://fripside.net/s3/skiyaki/uploads/image/file/1/cover.jpg";
const source = "https://fripside.net/musics/20902";
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16]);
afterEach(() => vi.unstubAllGlobals());

describe("R2 cover import", () => {
  it("stores verified image bytes with a deterministic key and provenance, reusing existing objects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(jpeg)));
    const head = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ key: "exists" });
    const put = vi.fn().mockResolvedValue({});
    const bucket = { head, put } as unknown as R2Bucket;
    const first = await importOfficialCover(bucket, url, source);
    const second = await importOfficialCover(bucket, url, source);
    expect(COVER_PATH_PATTERN.test(first)).toBe(true);
    expect(second).toBe(first);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][1]).toEqual(jpeg);
    expect(put.mock.calls[0][2].customMetadata).toEqual({ original_url: url, source_url: source });
  });

  it("rejects external URLs and redirects before contacting another origin", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/image.jpg" } }));
    await expect(downloadOfficialCover("https://evil.example/image.jpg", fetcher)).rejects.toThrow("官网图片");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(downloadOfficialCover(url, fetcher)).rejects.toThrow("官网图片");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects non-images, oversized Content-Length and unbounded chunked bodies", async () => {
    await expect(downloadOfficialCover(url, async () => new Response("<svg></svg>", { headers: { "content-type": "image/jpeg" } }))).rejects.toThrow("JPEG");
    await expect(downloadOfficialCover(url, async () => new Response(jpeg, { headers: { "content-length": String(MAX_COVER_BYTES + 1) } }))).rejects.toThrow("8 MB");
    await expect(downloadOfficialCover(url, async () => new Response(new Uint8Array(MAX_COVER_BYTES + 1)))).rejects.toThrow("8 MB");
  });

  it("does not report a local image path when storage fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(jpeg)));
    const bucket = { head: vi.fn().mockResolvedValue(null), put: vi.fn().mockRejectedValue(new Error("R2 unavailable")) } as unknown as R2Bucket;
    await expect(importOfficialCover(bucket, url, source)).rejects.toThrow("R2 unavailable");
  });
});
