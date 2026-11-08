import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedEventSearch } from "./event-search";
afterEach(() => vi.useRealTimers());
describe("event query cache", () => {
  it("coalesces concurrent misses and expires results", async () => {
    vi.useFakeTimers();
    const db = {} as D1Database;
    const load = vi.fn(async () => ({ count: 1 }));
    await Promise.all([cachedEventSearch(db, "total", load), cachedEventSearch(db, "total", load)]);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    await cachedEventSearch(db, "total", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("invalidates on database writes and does not retain failed requests", async () => {
    let revision = "1";
    const db = { getCacheRevision: () => revision } as unknown as D1Database;
    const load = vi.fn(async () => revision);
    expect(await cachedEventSearch(db, "page", load)).toBe("1");
    revision = "2";
    expect(await cachedEventSearch(db, "page", load)).toBe("2");
    expect(load).toHaveBeenCalledTimes(2);
    const fail = vi.fn(async () => { throw new Error("unavailable"); });
    await expect(cachedEventSearch(db, "fail", fail)).rejects.toThrow("unavailable");
    await expect(cachedEventSearch(db, "fail", fail)).rejects.toThrow("unavailable");
    expect(fail).toHaveBeenCalledTimes(2);
  });
});
