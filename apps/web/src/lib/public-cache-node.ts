import { ResponseCache } from "@frip-fan/node-runtime";
import { getEnv } from "./env";
const cache = new ResponseCache();
export async function publicResponse(key: string, next: () => Promise<Response>): Promise<Response> {
  if (import.meta.env.DEV) return next();
  const db = getEnv().DB as D1Database & { getCacheRevision(): string };
  const revision = db.getCacheRevision();
  const hit = cache.get(key, revision);
  if (hit) return hit;
  const response = await next();
  // A mutation during asynchronous rendering must not leave a stale entry.
  return db.getCacheRevision() === revision ? cache.put(key, revision, response) : response;
}
