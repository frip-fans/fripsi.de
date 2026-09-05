import { describe, expect, it, vi } from "vitest";
import { coverResponse } from "./cover-response";
const file = `${"a".repeat(64)}.jpg`;
const url = `https://fripsi.de/media/covers/${file}`;
function bucket() {
  const metadata = { httpEtag: '"abc"', size: 3 };
  return { head: vi.fn(async () => metadata), get: vi.fn(async () => ({ ...metadata, body: new Response(new Uint8Array([1, 2, 3])).body })) };
}
describe("R2 cover response", () => {
  it("streams images with immutable cache metadata and handles conditional/HEAD requests", async () => {
    const fake = bucket();
    const store = fake as unknown as R2Bucket;
    const response = await coverResponse(new Request(url), file, store);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const conditional = await coverResponse(new Request(url, { headers: { "if-none-match": 'W/"abc"' } }), file, store);
    expect(conditional.status).toBe(304);
    expect(conditional.body).toBeNull();
    const before = fake.get.mock.calls.length;
    const head = await coverResponse(new Request(url, { method: "HEAD" }), file, store);
    expect(head.body).toBeNull();
    expect(head.headers.get("content-length")).toBe("3");
    expect(fake.get.mock.calls.length).toBe(before);
  });
  it("does not expose other bucket paths or cache missing objects", async () => {
    const fake = bucket();
    expect((await coverResponse(new Request(url), "../secret", fake as unknown as R2Bucket)).status).toBe(404);
    expect(fake.get).not.toHaveBeenCalled();
    const missing = await coverResponse(new Request(url), file, { get: vi.fn().mockResolvedValue(null) } as unknown as R2Bucket);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });
});
