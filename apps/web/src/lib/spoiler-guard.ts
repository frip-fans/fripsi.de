/**
 * Spoiler guard for tours still on the road. Pages are cached for every visitor, so the server only
 * marks the setlist content and says until which day it is a spoiler; the browser decides whether
 * to cover it, from that date and from the tours this device has chosen to reveal.
 */

export const SPOILER_STORAGE_KEY = "frip_fan_spoilers_revealed";

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "getItem" | "setItem">;

/** Tour slugs revealed on this device; anything unreadable counts as nothing revealed. */
export function readRevealedTours(storage: ReadStorage): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(SPOILER_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function setTourRevealed(storage: WriteStorage, tour: string, revealed: boolean): void {
  const tours = readRevealedTours(storage).filter((slug) => slug !== tour);
  if (revealed) tours.push(tour);
  // Storage may be blocked; the choice then lasts for this page only.
  try { storage.setItem(SPOILER_STORAGE_KEY, JSON.stringify(tours.slice(-50))); } catch { /* optional */ }
}

/** The tour's dates are Japan dates, so "today" is too, wherever the visitor is. */
export function spoilerToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Covered through the last stop's day, unless this device revealed the tour. */
export function isSpoilerConcealed(until: string, tour: string, revealed: readonly string[], today: string): boolean {
  return today <= until && !revealed.includes(tour);
}
