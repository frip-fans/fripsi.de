import { describe, expect, it } from "vitest";
import { archiveLocationCounts, archiveYearCounts, matchesArchiveFilters, type ArchiveFilterItem } from "./archive-filter";

const items: ArchiveFilterItem[] = [
  { startDate: "2026-06-01", category: "LIVE", searchText: "tokyo live 東京都", locationKeys: ["jp:area_jp_13"] },
  { startDate: "2025-08-01", category: "EVENT", searchText: "singapore festival", locationKeys: ["country:SG"] },
  { startDate: "2024-04-01", category: "LIVE", searchText: "osaka live 大阪府", locationKeys: ["jp:area_jp_27"] },
];

describe("archive filters", () => {
  it("combines search, category, and location filters", () => {
    expect(matchesArchiveFilters(items[0], {
      query: "Tokyo live",
      categories: ["LIVE"],
      locations: ["jp:area_jp_13"],
    })).toBe(true);
    expect(matchesArchiveFilters(items[1], {
      query: "festival",
      categories: ["LIVE"],
      locations: [],
    })).toBe(false);
  });

  it("omits years without matching events", () => {
    expect(archiveYearCounts(items, {
      query: "",
      categories: ["LIVE"],
      locations: ["jp:area_jp_27"],
    })).toEqual([{ year: "2024", count: 1 }]);
  });

  it("counts an event once per location facet", () => {
    const counts = archiveLocationCounts([
      ...items,
      {
        startDate: "2026-07-01",
        category: "LIVE",
        searchText: "tour",
        locationKeys: ["jp:area_jp_13", "jp:area_jp_13", "country:SG"],
      },
    ]);
    expect(counts.get("jp:area_jp_13")).toBe(2);
    expect(counts.get("country:SG")).toBe(2);
  });
});
