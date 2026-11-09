import { listChangeSets } from "@frip-fan/core";

/**
 * Where a reviewer lands after publishing or discarding: the next pending proposal in list order,
 * or the pending list with a "done" notice once the queue is empty.
 */
export async function nextReviewLocation(db: D1Database, handledId: string, outcome: "published" | "discarded", eventId?: string): Promise<string> {
  const pending = await listChangeSets(db, "proposed", 200);
  const next = pending.find((change) => change.id !== handledId);
  if (!next) return `/admin/changes?done=${outcome}`;
  const params = new URLSearchParams({ handled: outcome });
  if (eventId) params.set("event", eventId);
  return `/admin/changes/${next.id}?${params}`;
}
