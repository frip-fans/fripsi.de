export async function boundedText(response: Response, maxBytes = 1_048_576): Promise<string> {
  if (!response.body) throw new Error("empty_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error("response_too_large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel(); }
}

export function officialUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !["fripside.net", "www.fripside.net"].includes(url.hostname)
    || url.port || url.username || url.password || url.pathname === "/") throw new Error("untrusted_source");
  url.hash = "";
  if (/^\/contents\/\d+\/?$/.test(url.pathname)) {
    url.hostname = "fripside.net";
    url.search = "";
    url.pathname = url.pathname.replace(/\/$/, "");
  }
  return url.href;
}

export function officialArticleUrl(raw: string): string {
  const url = officialUrl(raw);
  if (!/^https:\/\/fripside\.net\/contents\/\d+$/.test(url)) throw new ServiceError("invalid_source", "需要 fripside.net 的公开公告详情页", 400);
  return url;
}

export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type HtmlNode = ReturnType<typeof parseDocument> | ReturnType<typeof parseDocument>["children"][number];
type HtmlElement = Extract<HtmlNode, { attribs: Record<string, string> }>;
const isElement = (node: HtmlNode): node is HtmlElement => "attribs" in node && "name" in node;
function findNode(node: HtmlNode, predicate: (node: HtmlElement) => boolean): HtmlElement | null {
  if (isElement(node) && predicate(node)) return node;
  if ("children" in node) for (const child of node.children) { const found = findNode(child, predicate); if (found) return found; }
  return null;
}
const hasClass = (node: HtmlElement, name: string) => (node.attribs.class ?? "").split(/\s+/).includes(name);
const blockTags = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "dt", "dd", "br"]);
function visibleText(node: HtmlNode): string {
  if (node.type === "text") return node.data;
  if (isElement(node) && ["script", "style", "noscript", "nav", "footer", "svg"].includes(node.name)) return "";
  if (!("children" in node)) return "";
  const content = node.children.map(visibleText).join("");
  return isElement(node) && blockTags.has(node.name) ? `\n${content}\n` : content;
}

export interface SourceParagraph { id: string; text: string; section?: string }
export interface OfficialArticle {
  url: string; title: string; published_date: string | null; content_hash: string;
  paragraphs: SourceParagraph[]; fetched_at: string;
}

export async function parseOfficialArticle(rawUrl: string, html: string, fetchedAt = nowIso()): Promise<OfficialArticle> {
  const url = officialArticleUrl(rawUrl), dom = parseDocument(html);
  const article = findNode(dom, (node) => node.name === "article" && hasClass(node, "corner-content"));
  const body = article && findNode(article, (node) => hasClass(node, "corner-content-body"));
  const heading = article && findNode(article, (node) => node.name === "h2");
  const time = article && findNode(article, (node) => node.name === "time");
  if (!article || !body || !heading) throw new ServiceError("source_unavailable", "没有找到公开公告正文，不能读取登录或会员专属页面", 422);
  const title = visibleText(heading).replace(/\s+/g, " ").trim();
  const lines = visibleText(body).normalize("NFKC").split(/\n+/).map((line) => line.replace(/[\t \u00a0]+/g, " ").trim()).filter(Boolean);
  if (!title || !lines.length || lines.join("\n").length > 80_000 || lines.length > 180) throw new ServiceError("source_unavailable", "公告正文为空或超过读取上限", 422);
  const publishedDate = time?.attribs.datetime?.slice(0, 10) ?? null;
  let section: string | undefined;
  const sections = lines.map((text) => {
    if (/^(開催日程|開催日時|旅行期間|募集期間|申込期間|応募期間|受付期間|当落発表|発売日|配信日時|放送日時|会場|宿泊施設|配信詳細|出演|視聴ページ|注意事項)$/.test(text.replace(/[\s：:]/g,""))) section = text;
    return section;
  });
  const paragraphs = await Promise.all(lines.map(async (text, index) => ({ id: `p${index + 1}-${(await sha256(text)).slice(0, 12)}`, text, ...(sections[index] ? { section: sections[index] } : {}) })));
  return { url, title, published_date: publishedDate, content_hash: await sha256(JSON.stringify({ title, publishedDate, lines })), paragraphs, fetched_at: fetchedAt };
}

export async function fetchOfficialHtml(rawUrl: string, request: typeof fetch = fetch): Promise<string> {
  let target = officialUrl(rawUrl);
  for (let hop = 0; hop < 4; hop++) {
    const response = await request(target, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "fripsi-official-sync/2.0 (+https://fripsi.de)" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location) break;
      target = officialUrl(new URL(location, target).href); continue;
    }
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
      await response.body?.cancel(); throw new ServiceError("source_unavailable", "官网暂不可读取，将自动重试或交给复核", 422);
    }
    return boundedText(response, 524_288);
  }
  throw new ServiceError("source_unavailable", "官网重定向未能完成", 422);
}

export async function readOfficialArticle(db: D1Database, rawUrl: string, refresh = false, request: typeof fetch = fetch): Promise<OfficialArticle> {
  const url = officialArticleUrl(rawUrl);
  const saved = await db.prepare("SELECT * FROM official_sync_sources WHERE url = ?").bind(url).first<{
    title: string; published_date: string | null; content_hash: string; paragraphs_json: string; fetched_at: string;
  }>();
  if (!refresh && saved && Date.now() - Date.parse(saved.fetched_at) < 15 * 60_000) return { ...saved, url, paragraphs: JSON.parse(saved.paragraphs_json) as SourceParagraph[] };
  const article = await parseOfficialArticle(url, await fetchOfficialHtml(url, request));
  await db.prepare(`INSERT INTO official_sync_sources (url,title,published_date,content_hash,paragraphs_json,fetched_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(url) DO UPDATE SET title=excluded.title,published_date=excluded.published_date,content_hash=excluded.content_hash,paragraphs_json=excluded.paragraphs_json,fetched_at=excluded.fetched_at`)
    .bind(url, article.title, article.published_date, article.content_hash, JSON.stringify(article.paragraphs), article.fetched_at).run();
  return article;
}

export function evidenceParagraphs(article: OfficialArticle, revision: string | undefined, refs: string[]): SourceParagraph[] {
  if (revision !== article.content_hash) throw new ServiceError("source_changed", "公告版本已变化，请重新 sources.read 并选择证据段落", 409);
  const selected = refs.map((id) => article.paragraphs.find((paragraph) => paragraph.id === id));
  if (!selected.length || selected.some((part) => !part)) throw new ServiceError("evidence_refs_invalid", "证据编号无效，请使用 sources.read 返回的段落编号", 400);
  const wanted = new Set(refs);
  return article.paragraphs.filter((paragraph) => wanted.has(paragraph.id));
}

export function sourceDateCandidates(text: string, publishedDate: string | null, title = "", includeBroadcastOffsets = true): Set<string> {
  const normalized = normalizeClockNotation(text), dates = new Set<string>();
  const explicitYears = [...normalized.matchAll(/(20\d{2})(?:年|(?=[/.-]\d{1,2}[/.-]\d{1,2}))/g)].map((match) => match[1]);
  const fallbackYears = [publishedDate?.slice(0, 4), ...title.matchAll(/20\d{2}/g)].map((year) => typeof year === "string" ? year : year?.[0]).filter((year): year is string => Boolean(year));
  const years = new Set(explicitYears.length ? explicitYears : fallbackYears);
  const add = (year: string, month: string, day: string) => {
    const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`, parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date) dates.add(date);
  };
  for (const match of normalized.matchAll(/(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日)?/g)) { add(match[1], match[2], match[3]); years.add(match[1]); }
  for (const match of normalized.matchAll(/(?<![\d年])(\d{1,2})月(\d{1,2})日/g)) for (const year of years) add(year, match[1], match[2]);
  for (const match of normalized.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) for (const year of years) add(year, match[1], match[2]);
  if (includeBroadcastOffsets) for (const match of normalized.matchAll(/\b(2[4-9]|[34]\d):([0-5]\d)\b/g)) for (const date of [...dates]) dates.add(normalizeBroadcastTime(date, `${match[1]}:${match[2]}`).date);
  return dates;
}

export function nextOfficialNewsPage(html: string, currentUrl: string): string | null {
  const current = new URL(currentUrl), page = Number(current.pathname.match(/^\/contents\/news\/page\/(\d+)\/?$/)?.[1] ?? current.searchParams.get("page") ?? 1);
  let next: string | null = null;
  function visit(node: HtmlNode) {
    if (isElement(node) && node.name === "a" && node.attribs.href) {
      try {
        const candidate = new URL(officialUrl(new URL(node.attribs.href, current).href));
        const path = candidate.pathname.match(/^\/contents\/news(?:\/page\/(\d+))?\/?$/);
        if (path && Number(path[1] ?? candidate.searchParams.get("page")) === page + 1) next = candidate.href;
      } catch { /* Only follow official news pagination. */ }
    }
    if ("children" in node) node.children.forEach(visit);
  }
  visit(parseDocument(html)); return next;
}

export function parseOfficialNewsLinks(html: string): Array<{ url: string; published_date: string | null }> {
  const dom = parseDocument(html), result = new Map<string, { url: string; published_date: string | null }>();
  function visit(node: HtmlNode) {
    if (isElement(node) && node.name === "a" && node.attribs.href) {
      try {
        const url = officialArticleUrl(new URL(node.attribs.href, "https://fripside.net/contents/news").href);
        const text = visibleText(node).normalize("NFKC"), match = text.match(/(20\d{2})\s*[.年/-]\s*(\d{1,2})\s*[.月/-]\s*(\d{1,2})/);
        const date = match ? `${match[1]}-${match[2].padStart(2,"0")}-${match[3].padStart(2,"0")}` : null;
        if (!result.has(url)) result.set(url, { url, published_date: date });
      } catch { /* Ignore navigation and external links. */ }
    }
    if ("children" in node) node.children.forEach(visit);
  }
  visit(dom); return [...result.values()].slice(0, 30);
}

export function plainText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:#(x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|nbsp);/gi, (entity, numeric: string | undefined) => {
      if (numeric) {
        const code = numeric[0].toLowerCase() === "x" ? parseInt(numeric.slice(1), 16) : parseInt(numeric, 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
      }
      return ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " } as Record<string, string>)[entity.toLowerCase()] ?? entity;
    }).normalize("NFKC").replace(/\s+/g, "").trim();
}

export async function verifyEvidence(url: string, quote: string, request: typeof fetch = fetch): Promise<boolean> {
  let target = officialUrl(url);
  for (let hop = 0; hop < 4; hop++) {
    const response = await request(target, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) return false;
      target = officialUrl(new URL(location, target).href);
      continue;
    }
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
      await response.body?.cancel();
      return false;
    }
    const text = plainText(await boundedText(response, 524_288));
    const normalizedQuote = quote.normalize("NFKC").replace(/\s+/g, "");
    return normalizedQuote.length >= 20 && text.includes(normalizedQuote);
  }
  return false;
}
import { parseDocument } from "htmlparser2";
import { ServiceError, nowIso } from "./utils";
import { normalizeBroadcastTime, normalizeClockNotation } from "./sync-policy";
