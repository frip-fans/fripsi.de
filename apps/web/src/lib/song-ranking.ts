/** Rank by show count with ties sharing a rank (1, 2, 2, 4); songs never performed get no rank. */
export function rankByShows<T extends { id: string; show_count: number }>(songs: readonly T[]): Map<string, number> {
  const ordered = songs.filter(song => song.show_count > 0).sort((a, b) => b.show_count - a.show_count);
  const ranks = new Map<string, number>();
  ordered.forEach((song, index) => {
    const previous = ordered[index - 1];
    ranks.set(song.id, previous && previous.show_count === song.show_count ? ranks.get(previous.id)! : index + 1);
  });
  return ranks;
}
