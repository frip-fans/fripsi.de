import { describe, expect, it } from "vitest";
import { computeSetlistHighlights, DEFAULT_RETURN_GAP_DAYS, type SetlistHighlightRow } from "./setlist-highlights";

const row = (setlist_id: string, start_date: string, song_id: string, first_release_date: string | null = "2000-01-01", song_title = song_id): SetlistHighlightRow =>
  ({ setlist_id, start_date, song_id, song_title, display_title: `${song_title} -version-`, first_release_date });

describe("setlist highlights", () => {
  it("marks first performances as debuts only for songs released after the archive starts", () => {
    const result = computeSetlistHighlights([
      row("a", "2010-01-01", "old", "2005-01-01"),
      row("b", "2011-01-01", "old", "2005-01-01"),
      row("b", "2011-01-01", "new", "2010-06-01"),
      row("b", "2011-01-01", "undated", null),
    ]);
    expect(result.get("a")!.debuts).toEqual([]);
    expect(result.get("b")!.debuts.map(debut => debut.song_id)).toEqual(["new"]);
  });

  it("reports returns at or beyond the gap, longest first, and ignores shorter gaps", () => {
    const result = computeSetlistHighlights([
      row("a", "2010-01-01", "x"), row("a", "2010-01-01", "y"), row("a", "2010-01-01", "z"),
      row("b", "2013-01-01", "y"),
      row("c", "2015-01-01", "x"), row("c", "2015-01-01", "y"), row("c", "2015-01-01", "z"),
    ]);
    expect(result.get("b")!.returns.map(item => item.song_id)).toEqual(["y"]);
    const returns = result.get("c")!.returns;
    // y returns after exactly two years (730 days), which meets the threshold.
    expect(returns.map(item => item.song_id)).toEqual(["x", "z", "y"]);
    expect(returns[0]).toMatchObject({ previous_date: "2010-01-01", gap_days: 1826 });
    expect(DEFAULT_RETURN_GAP_DAYS).toBe(730);
  });

  it("dedupes repeated songs inside one setlist and keeps the performance order", () => {
    const result = computeSetlistHighlights([
      row("a", "2010-01-01", "x", "2000-01-01", "X"), row("a", "2010-01-01", "y", "2000-01-01", "Y"), row("a", "2010-01-01", "x", "2000-01-01", "X"),
      row("b", "2014-01-01", "x"),
    ]);
    expect(result.get("a")!.songs).toEqual(["X", "Y"]);
    expect(result.get("b")!.returns).toHaveLength(1);
  });
});
