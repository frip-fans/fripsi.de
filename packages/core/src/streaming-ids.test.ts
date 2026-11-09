import { describe, expect, it } from "vitest";
import { matchAppleTracks, normalizeCatalogTitle, parseAppleMusicRef, parseYouTubeId } from "./streaming-ids";

describe("streaming id parsing", () => {
  it("reads Apple Music album, track and song URLs", () => {
    expect(parseAppleMusicRef("https://music.apple.com/jp/album/infinite-synthesis/1804662303")).toEqual({ storefront: "jp", albumId: "1804662303", trackId: null });
    expect(parseAppleMusicRef("https://music.apple.com/jp/album/x/1804664400?i=1804664579&uo=4")).toEqual({ storefront: "jp", albumId: "1804664400", trackId: "1804664579" });
    expect(parseAppleMusicRef("https://embed.music.apple.com/us/album/1804664400?i=1804664579&theme=dark")?.storefront).toBe("us");
    expect(parseAppleMusicRef("https://music.apple.com/jp/song/only-my-railgun/1804664579")).toEqual({ storefront: "jp", albumId: null, trackId: "1804664579" });
    expect(parseAppleMusicRef("1804662303")?.albumId).toBe("1804662303");
    expect(parseAppleMusicRef("1804664579", "track")?.trackId).toBe("1804664579");
  });

  it("rejects other hosts and malformed input", () => {
    expect(parseAppleMusicRef("https://evil.example/jp/album/x/1")).toBeNull();
    expect(parseAppleMusicRef("not a url")).toBeNull();
    expect(parseAppleMusicRef("")).toBeNull();
  });

  it("reads YouTube ids from common URL shapes", () => {
    for (const value of [
      "ZhIxg6_Femo",
      "https://www.youtube.com/watch?v=ZhIxg6_Femo&list=x",
      "https://youtu.be/ZhIxg6_Femo?t=3",
      "https://music.youtube.com/watch?v=ZhIxg6_Femo",
      "https://www.youtube-nocookie.com/embed/ZhIxg6_Femo?rel=0",
    ]) expect(parseYouTubeId(value)).toBe("ZhIxg6_Femo");
    expect(parseYouTubeId("https://vimeo.com/123")).toBeNull();
    expect(parseYouTubeId("short")).toBeNull();
  });
});

describe("Apple track matching", () => {
  it("normalizes width, case and edition suffixes", () => {
    expect(normalizeCatalogTitle("Ｗandering Traveler - Single")).toBe(normalizeCatalogTitle("Wandering Traveler"));
    expect(normalizeCatalogTitle("only my railgun（TVアニメ「とある科学の超電磁砲」オープニングテーマ）")).toBe("onlymyrailgun");
  });

  it("prefers position plus title, then unique titles, and never reuses an Apple track", () => {
    const local = [
      { disc_number: 1, track_number: 1, display_title: "only my railgun" },
      { disc_number: 1, track_number: 2, display_title: "LEVEL5 -judgelight-" },
      { disc_number: 1, track_number: 3, display_title: "Unknown local title" },
    ];
    const apple = [
      { trackId: 11, discNumber: 1, trackNumber: 1, trackName: "only my railgun" },
      { trackId: 13, discNumber: 1, trackNumber: 3, trackName: "LEVEL5-judgelight-" },
      { trackId: 12, discNumber: 1, trackNumber: 2, trackName: "something else" },
    ];
    expect(matchAppleTracks(local, apple)).toEqual(["11", "13", null]);
    expect(matchAppleTracks(local.slice(0, 2), apple.slice(0, 2).reverse())).toEqual(["11", "13"]);
    expect(matchAppleTracks(local, apple.slice(0, 2))).toEqual(["11", "13", null]);
  });
});
