import { describe, it, expect, vi } from "vitest";
import { ResponseCache } from "./cache";
const page = (value: string) => new Response(value, { headers: { "content-type": "text/html" } });
describe("public response cache", () => {
  it("expires entries and invalidates across database revisions", async () => {
    vi.useFakeTimers();
    try {
      const cache = new ResponseCache(100, 50);
      await cache.put("a", "v1", page("one"));
      expect(await cache.get("a", "v1")?.text()).toBe("one");
      expect(cache.get("a", "v2")).toBeUndefined();
      await cache.put("a", "v2", page("two"));
      vi.advanceTimersByTime(51);
      expect(cache.get("a", "v2")).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
  it("bounds memory and never stores private, failing or cookie responses", async () => {
    const cache = new ResponseCache(6);
    await cache.put("a", "v1", page("1234"));
    await cache.put("b", "v1", page("5678"));
    expect(cache.get("a", "v1")).toBeUndefined();
    expect(await cache.get("b", "v1")?.text()).toBe("5678");
    for (const headers of [{ "set-cookie": "session=secret" }, { "cache-control": "private" }, { "cache-control": "no-store" }] as Record<string, string>[]) {
      await cache.put("private", "v1", new Response("secret", { headers: { "content-type": "text/html", ...headers } }));
      expect(cache.get("private", "v1")).toBeUndefined();
    }
    await cache.put("failure", "v1", new Response("oops", { status: 500 }));
    expect(cache.get("failure", "v1")).toBeUndefined();
  });
});
