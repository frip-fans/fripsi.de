import { describe, expect, it } from "vitest";
import { rankByShows } from "./song-ranking";

describe("song ranking", () => {
  it("shares ranks on ties, skips the following ranks, and leaves unperformed songs unranked", () => {
    const ranks = rankByShows([
      { id: "c", show_count: 5 },
      { id: "a", show_count: 9 },
      { id: "b", show_count: 5 },
      { id: "d", show_count: 1 },
      { id: "e", show_count: 0 },
    ]);
    expect(Object.fromEntries(ranks)).toEqual({ a: 1, c: 2, b: 2, d: 4 });
    expect(ranks.has("e")).toBe(false);
  });
});
