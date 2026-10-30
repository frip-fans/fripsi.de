/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { evidenceParagraphs, officialArticleUrl, parseOfficialArticle, parseOfficialNewsLinks, readOfficialArticle, sourceDateCandidates } from "./official-source";
import { normalizeBroadcastTime } from "./sync-policy";
import { createTestD1 } from "./test-d1";

const url = "https://fripside.net/contents/1123461";
export const articleHtml = (body: string, title = "製作委員会の森 第31回", date = "2026-10-29") => `<nav>navigation is not evidence</nav><article class="corner-content"><h2>${title}</h2><time datetime="${date}">${date}</time><div class="corner-content-body">${body}</div></article><footer>footer is not evidence</footer>`;
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe("official paragraph evidence", () => {
  it("extracts real article paragraphs, decodes entities, and excludes navigation and scripts", async () => {
    const source = await parseOfficialArticle(url, articleHtml('<h4>開催日程</h4><p>2026年11月24日(火)<br>20:30 開始予定</p><p>A &amp; B</p><script>untrusted script</script>'));
    expect(source.paragraphs.map((paragraph) => paragraph.text)).toEqual(["開催日程", "2026年11月24日(火)", "20:30 開始予定", "A & B"]);
    expect(source.title).toContain("第31回");
    expect(source.content_hash).toHaveLength(64);
    expect(source.paragraphs[0].id).toMatch(/^p1-[a-f0-9]{12}$/);
    expect(evidenceParagraphs(source, source.content_hash, [source.paragraphs[1].id])).toEqual([source.paragraphs[1]]);
    expect(() => evidenceParagraphs(source, "a".repeat(64), [source.paragraphs[1].id])).toThrow("版本已变化");
    expect(() => evidenceParagraphs(source, source.content_hash, ["p999-000000000000"])).toThrow("证据编号无效");
  });
  it("does not treat a login page or news list as a detail-page source", async () => {
    expect(() => officialArticleUrl("https://fripside.net/contents/news")).toThrow();
    await expect(parseOfficialArticle(url, "<h2>Login</h2><p>please sign in</p>")).rejects.toMatchObject({ code: "source_unavailable" });
  });
  it("canonicalizes official article aliases and rejects external sources", () => {
    expect(officialArticleUrl("https://www.fripside.net/contents/1123461/?utm_source=x#date")).toBe(url);
    expect(() => officialArticleUrl("https://fripside.net.evil.test/contents/1")).toThrow();
  });
  it("uses an unchanged content revision across fetches and changes revision on a factual edit", async () => {
    const one = await parseOfficialArticle(url, articleHtml("<p>20:30 開始</p>"), "2026-10-29T00:00:00Z");
    const two = await parseOfficialArticle(url, articleHtml("<p>20:30 開始</p>"), "2026-10-30T00:00:00Z");
    const changed = await parseOfficialArticle(url, articleHtml("<p>21:00 開始</p>"));
    expect(one.content_hash).toBe(two.content_hash); expect(one.content_hash).not.toBe(changed.content_hash);
  });
  it("caches public text and verifies every redirect before a request", async () => {
    const { db, sqlite } = createTestD1(); databases.push(sqlite);
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(articleHtml("<p>2026年11月24日 20:30</p>"), { headers: { "content-type": "text/html" } }));
    await readOfficialArticle(db, url, false, request); await readOfficialArticle(db, url, false, request);
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://unrelated.test/" } }));
    await expect(readOfficialArticle(db, url, true, request)).rejects.toThrow("untrusted_source");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("extracts only canonical detail links from a news list", () => {
    expect(parseOfficialNewsLinks('<a href="/contents/1123461">2026. 10.29 第31回</a><a href="/login">login</a><a href="https://other.test/contents/1">other</a>'))
      .toEqual([{ url, published_date: "2026-10-29" }]);
  });
  it("recognizes range dates and Japanese after-midnight broadcasts", () => {
    expect([...sourceDateCandidates("旅行期間2026年12月5日～12月6日", "2026-10-19")]).toEqual(expect.arrayContaining(["2026-12-05", "2026-12-06"]));
    expect([...sourceDateCandidates("2025年7月29日25:58～27:08", "2025-07-22")]).toContain("2025-07-30");
    expect(normalizeBroadcastTime("2025-07-29", "２５：５８")).toEqual({ date: "2025-07-30", time: "01:58" });
    expect(() => normalizeBroadcastTime("2025-02-30", "25:58")).toThrow();
  });
});
