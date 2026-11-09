import { describe, expect, it } from "vitest";
import { createSetlistMatcher, normalizeTitle } from "./setlist-paste";

const songs = [
  { id: "sky", title: "sky" },
  { id: "omr", title: "only my railgun" },
  { id: "1983", title: "1983-schwarzesmarken-" },
  { id: "level5", title: "LEVEL5-judgelight-", aliases: "LEVEL５-judgelight-" },
  { id: "sister", title: "sister's noise", aliases: "sister’s noise" },
  { id: "wanda", title: "Wanderer" },
  { id: "wonderful", title: "Wonderful" },
];
const versions = [
  { id: "sky-2008", song_id: "sky", title: "sky -version 2008-" },
  { id: "sky-2002", song_id: "sky", title: "sky" },
  { id: "omr-1", song_id: "omr", title: "only my railgun" },
];

describe("pasted setlist matching", () => {
  const match = createSetlistMatcher(songs, versions);

  it("normalizes width, case, spacing and punctuation", () => {
    expect(normalizeTitle("ＯＮＬＹ  my  Railgun")).toBe(normalizeTitle("only my railgun"));
    expect(normalizeTitle("sister’s noise")).toBe(normalizeTitle("sister's noise"));
  });

  it("strips numbering, follows encore markers and picks the only version", () => {
    const entries = match("01. only my railgun\nM-2 sky -version 2008-\n\nEncore\nEN1) sister’s noise\n1983-schwarzesmarken-");
    expect(entries.map((entry) => [entry.songId, entry.versionId, entry.section, entry.match])).toEqual([
      ["omr", "omr-1", "main", "exact"],
      ["sky", "sky-2008", "main", "exact"],
      ["sister", null, "encore", "exact"],
      ["1983", null, "encore", "exact"],
    ]);
  });

  it("leaves a song with several versions unpicked and reports unknown lines", () => {
    const entries = match("sky\nlevel5\nwond\nsomething new");
    expect(entries[0]).toMatchObject({ songId: "sky", versionId: null, match: "exact" });
    expect(entries[1]).toMatchObject({ songId: "level5", match: "loose" });
    expect(entries[2]).toMatchObject({ songId: "wonderful", match: "loose" });
    expect(entries[3]).toMatchObject({ songId: null, match: "none", line: "something new" });
  });
});
