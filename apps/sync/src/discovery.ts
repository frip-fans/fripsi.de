import { fetchOfficialHtml, nextOfficialNewsPage, officialArticleUrl, parseOfficialNewsLinks, readOfficialArticle } from "@frip-fan/core";

export const DISCOVERY_LOOKBACK_DAYS = 60;

export interface DiscoveryResult {
  articles: Array<{ source_url: string; title: string; published_date: string | null; source_revision: string }>;
  errors: Array<{ source_url: string; code: string }>;
}

export async function discover(db: D1Database, runId: string, now: Date, force = false, request: typeof fetch = fetch): Promise<DiscoveryResult> {
  const cutoff = new Date(now.valueOf() - DISCOVERY_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const today = new Date(now.valueOf() + 9 * 3_600_000).toISOString().slice(0, 10);
  const links: ReturnType<typeof parseOfficialNewsLinks> = [];
  let page: string | null = "https://fripside.net/contents/news";
  const result: DiscoveryResult = { articles: [], errors: [] };
  for (let index = 0; page && index < 4; index++) {
    const currentPage: string = page;
    try {
      const html = await fetchOfficialHtml(currentPage, request), found = parseOfficialNewsLinks(html);
      links.push(...found);
      page = found.length && found.every((link) => link.published_date && link.published_date < cutoff) ? null : nextOfficialNewsPage(html, currentPage);
    } catch {
      result.errors.push({ source_url: currentPage, code: "source_temporarily_unavailable" }); break;
    }
  }
  const upcoming = await db.prepare(`SELECT DISTINCT s.url FROM event_sources s JOIN events e ON e.id=s.event_id
    WHERE e.published=1 AND e.archived_at IS NULL AND COALESCE(e.end_date,e.start_date)>=?
    AND (s.url LIKE 'https://fripside.net/contents/%' OR s.url LIKE 'https://www.fripside.net/contents/%') LIMIT 12`).bind(today).all<{ url: string }>();
  const urls = new Set(links.filter((link) => !link.published_date || link.published_date >= cutoff).map((link) => link.url));
  for (const row of upcoming.results) { try { urls.add(officialArticleUrl(row.url)); } catch { /* Only detail pages. */ } }
  if (!urls.size) return result;
  const cached = await db.prepare(`SELECT url,fetched_at,processed_hash FROM official_sync_sources WHERE url IN (${[...urls].map(() => "?").join(",")})`)
    .bind(...urls).all<{ url: string; fetched_at: string; processed_hash: string | null }>();
  const checkpoints = new Map(cached.results.map((row) => [row.url, row]));
  // Unseen articles first; then rotate refreshes by age so an unchanged head
  // cannot keep older notices beyond the per-run work limit forever.
  const pending = [...urls].sort((a, b) => (checkpoints.get(a)?.fetched_at ?? "").localeCompare(checkpoints.get(b)?.fetched_at ?? ""));
  for (const url of pending.slice(0, 24)) {
    if (result.articles.length >= 16) break;
    try {
      const article = await readOfficialArticle(db, url, true, request);
      const checkpoint = checkpoints.get(article.url);
      if (!force && checkpoint?.processed_hash === article.content_hash) continue;
      await db.prepare("INSERT INTO official_sync_run_sources (run_id,url,content_hash) VALUES (?,?,?) ON CONFLICT(run_id,url) DO UPDATE SET content_hash=excluded.content_hash")
        .bind(runId, article.url, article.content_hash).run();
      result.articles.push({ source_url: article.url, title: article.title, published_date: article.published_date, source_revision: article.content_hash });
    } catch { result.errors.push({ source_url: url, code: "source_temporarily_unavailable" }); }
  }
  return result;
}
