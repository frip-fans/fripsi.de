/** Rows per page in a song's performance history. */
export const HISTORY_PAGE_SIZE = 15;

export type PageToken = number | "gap-start" | "gap-end";

/** Page numbers with gaps, matching the site pagination: 1 … 4 5 6 … 12. */
export function pageTokens(current: number, total: number): PageToken[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "gap-end", total];
  if (current >= total - 3) return [1, "gap-start", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "gap-start", current - 1, current, current + 1, "gap-end", total];
}

export function clampPage(requested: number, total: number): number {
  return Math.min(Math.max(1, total), Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 1));
}
