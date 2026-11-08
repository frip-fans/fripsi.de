import { countPublicEventSearch, getPublicEventFilters, listPublicEventSearch, parsePublicEventSearch } from "@frip-fan/core";

// Shared across locales and query pages. Promises also coalesce concurrent misses.
// The SQLite revision includes writes from the MCP/sync connection.
const databases = new WeakMap<D1Database, Map<string, { expires: number; revision: string; value: Promise<unknown> }>>();
const cacheEpoch = crypto.randomUUID();
export const eventSearchRevision = (db: D1Database) => {
  const revision = (db as D1Database & { getCacheRevision?(): string }).getCacheRevision?.();
  // Session snapshots must not confuse revisions from different server lifetimes.
  return revision === undefined ? "" : `${cacheEpoch}:${revision}`;
};
export async function cachedEventSearch<T>(db: D1Database, key: string, load: () => Promise<T>): Promise<T> {
  let cache = databases.get(db);
  if (!cache) { cache = new Map(); databases.set(db, cache); }
  const revision = eventSearchRevision(db);
  const hit = cache.get(key);
  if (hit && hit.revision === revision && hit.expires > Date.now()) {
    cache.delete(key); cache.set(key, hit);
    return hit.value as Promise<T>;
  }
  cache.delete(key);
  while (cache.size >= 64) cache.delete(cache.keys().next().value!);
  const entry = { expires: Date.now() + 60_000, revision, value: load() };
  cache.set(key, entry);
  try { return await entry.value; }
  catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
}
export const publicEventFilters = (db: D1Database) => cachedEventSearch(db, "filters", () => getPublicEventFilters(db));
export async function publicEventResults(db: D1Database, params: URLSearchParams) {
  const input = parsePublicEventSearch(params);
  const [page, total] = await Promise.all([
    cachedEventSearch(db, `page:${JSON.stringify(input)}`, () => listPublicEventSearch(db, input)),
    cachedEventSearch(db, `count:${JSON.stringify({ ...input, after: "" })}`, () => countPublicEventSearch(db, input)),
  ]);
  return { ...page, total };
}
