import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHED_COVER_MS, setupReleaseCovers } from "./release-cover";

class FakeCover extends EventTarget {
  dataset: Record<string, string>;
  hidden = true;
  complete = false;
  naturalWidth = 0;
  parentElement = {};
  private source = "";
  constructor(url: string, private readonly cachedInMemory = false) {
    super();
    this.dataset = { coverSrc: url };
  }
  get src() { return this.source; }
  set src(value: string) {
    this.source = value;
    if (this.cachedInMemory) { this.complete = true; this.naturalWidth = 480; }
  }
  finishLoading(width = 480) {
    this.complete = true;
    this.naturalWidth = width;
    this.dispatchEvent(new Event("load"));
  }
}

const setup = (...covers: FakeCover[]) => setupReleaseCovers({ querySelectorAll: () => covers } as unknown as ParentNode);

describe("release cover loading", () => {
  let now = 0;
  beforeEach(() => { now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("shows memory-cached covers immediately without the first-load fade", () => {
    const cover = new FakeCover("/media/covers/a.jpg", true);
    setup(cover);
    expect(cover.hidden).toBe(false);
    expect(cover.src).toBe("/media/covers/a.jpg");
    expect(cover.dataset).toMatchObject({ coverLoaded: "true", coverCached: "true" });
  });

  it("treats a fast asynchronous load as cached", () => {
    const cover = new FakeCover("/media/covers/b.jpg");
    setup(cover);
    expect(cover.dataset.coverLoaded).toBeUndefined();
    now += CACHED_COVER_MS - 1;
    cover.finishLoading();
    expect(cover.dataset).toMatchObject({ coverLoaded: "true", coverCached: "true" });
  });

  it("keeps the fade for covers downloaded from the network", () => {
    const cover = new FakeCover("/media/covers/c.jpg");
    setup(cover);
    now += CACHED_COVER_MS + 50;
    cover.finishLoading();
    expect(cover.dataset.coverLoaded).toBe("true");
    expect(cover.dataset.coverCached).toBeUndefined();
  });

  it("falls back to the placeholder when the source serves a 1x1 pixel instead of artwork", () => {
    const cover = new FakeCover("/media/covers/blank.png");
    setup(cover);
    cover.finishLoading(1);
    expect(cover.hidden).toBe(true);
    expect(cover.dataset.coverLoaded).toBeUndefined();
  });
});
