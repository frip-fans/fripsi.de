export interface ArchiveFilterItem {
  startDate: string;
  category: string;
  searchText: string;
  locationKeys: string[];
}

export interface ArchiveFilterState {
  query: string;
  categories: readonly string[];
  locations: readonly string[];
}

export function matchesArchiveFilters(item: ArchiveFilterItem, state: ArchiveFilterState): boolean {
  const terms = state.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const categories = new Set(state.categories);
  const locations = new Set(state.locations);
  return terms.every((term) => item.searchText.includes(term))
    && (categories.size === 0 || categories.has(item.category))
    && (locations.size === 0 || item.locationKeys.some((key) => locations.has(key)));
}

export function archiveYearCounts(
  items: readonly ArchiveFilterItem[],
  state: ArchiveFilterState,
): Array<{ year: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!matchesArchiveFilters(item, state)) continue;
    const year = item.startDate.slice(0, 4);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return [...counts].map(([year, count]) => ({ year, count }))
    .sort((left, right) => right.year.localeCompare(left.year));
}

export function archiveLocationCounts(items: readonly ArchiveFilterItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const key of new Set(item.locationKeys)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
