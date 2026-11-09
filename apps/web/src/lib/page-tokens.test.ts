import { describe, expect, it } from "vitest";
import { clampPage, pageTokens } from "./page-tokens";

describe("history page tokens", () => {
  it("lists every page when there are few and gaps around the current page otherwise", () => {
    expect(pageTokens(1, 3)).toEqual([1, 2, 3]);
    expect(pageTokens(2, 8)).toEqual([1, 2, 3, 4, 5, "gap-end", 8]);
    expect(pageTokens(5, 12)).toEqual([1, "gap-start", 4, 5, 6, "gap-end", 12]);
    expect(pageTokens(11, 12)).toEqual([1, "gap-start", 8, 9, 10, 11, 12]);
  });
  it("clamps requested pages into range", () => {
    expect(clampPage(0, 8)).toBe(1);
    expect(clampPage(99, 8)).toBe(8);
    expect(clampPage(Number.NaN, 8)).toBe(1);
    expect(clampPage(3.7, 8)).toBe(3);
    expect(clampPage(2, 0)).toBe(1);
  });
});
