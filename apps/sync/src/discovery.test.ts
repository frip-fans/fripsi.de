/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import { createTestD1 } from "../../../packages/core/src/test-d1";
import { discover } from "./discovery";

it("suppresses unchanged official articles and detects a changed factual paragraph", async () => {
  const { db, sqlite } = createTestD1();
  try {
    const now = new Date(), day = now.toISOString().slice(0,10), indexDate = day.replaceAll("-", ".");
    sqlite.prepare("INSERT INTO official_sync_runs (id,status,created_at,updated_at) VALUES ('run','starting',?,?)").run(now.toISOString(),now.toISOString());
    let time = "20:30";
    const request = vi.fn<typeof fetch>().mockImplementation(async (url) => new Response(String(url).endsWith("/news")
      ? `<a href="/contents/1123461">${indexDate} 公告</a>`
      : `<article class="corner-content"><h2>节目</h2><time datetime="${day}"></time><div class="corner-content-body"><p>2026年11月24日 ${time}開始</p></div></article>`, { headers: { "content-type": "text/html" } }));
    expect((await discover(db, "run", now, false, request)).articles).toHaveLength(1);
    sqlite.prepare("UPDATE official_sync_sources SET processed_hash=content_hash").run();
    expect((await discover(db, "run", now, false, request)).articles).toHaveLength(0);
    time = "21:00";
    expect((await discover(db, "run", now, false, request)).articles).toHaveLength(1);
  } finally { sqlite.close(); }
});

it("finds advance notices on later news pages and does not starve them behind processed articles", async () => {
  const { db, sqlite } = createTestD1();
  try {
    const now = new Date('2026-10-30T04:00:00Z');
    sqlite.prepare("INSERT INTO official_sync_runs (id,status,created_at,updated_at) VALUES ('run','starting',?,?)").run(now.toISOString(), now.toISOString());
    const recent = Array.from({ length: 16 }, (_, i) => `<a href="/contents/${1200000+i}">2026.10.29 notice</a>`).join('');
    const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const address = String(url);
      const html = address.endsWith('/news') ? `${recent}<a href="/contents/news/page/2" rel="next">次へ</a>`
        : address.includes('/news/page/2') ? '<a href="/contents/1113518">2026.09.26 第30回</a><a href="https://evil.test/contents/news/page/3">next</a>'
        : `<article class="corner-content"><h2>第30回</h2><time datetime="${address.endsWith('1113518') ? '2026-09-26' : '2026-10-29'}"></time><div class="corner-content-body"><p>2026年10月23日20:30開始</p></div></article>`;
      return new Response(html, {headers:{'content-type':'text/html'}});
    });
    expect((await discover(db, 'run', now, false, request)).articles).toHaveLength(16);
    sqlite.prepare('UPDATE official_sync_sources SET processed_hash=content_hash').run();
    const catchup = await discover(db, 'run', now, false, request);
    expect(catchup.articles.map(article => article.source_url)).toEqual(['https://fripside.net/contents/1113518']);
    expect(request.mock.calls.some(([url]) => String(url).includes('evil.test'))).toBe(false);
  } finally { sqlite.close(); }
});

describe("official source health", () => {
  const now = new Date("2026-11-09T04:00:00Z");
  const html = (body: string, status = 200, type = "text/html") => new Response(body, { status, headers: { "content-type": type } });
  const index = '<a href="/contents/1124469">2026.11.03 FAN MEETING</a><a href="/contents/1123461">2026.10.29 第31回</a>';
  const article = '<article class="corner-content"><h2>公告</h2><time datetime="2026-11-03"></time><div class="corner-content-body"><p>2026年11月24日 20:30開始</p></div></article>';
  function setup() {
    const { db, sqlite } = createTestD1();
    sqlite.prepare("INSERT INTO official_sync_runs (id,status,created_at,updated_at) VALUES ('run','starting',?,?)").run(now.toISOString(), now.toISOString());
    return { db, sqlite };
  }

  it.each([
    ["blocked", () => html("Forbidden", 403)],
    ["rate limited", () => html("Too many requests", 429)],
    ["served a non-HTML body", () => html("{}", 200, "application/json")],
    ["unreachable", () => Promise.reject(new TypeError("fetch failed"))],
  ])("treats a news index that is %s as unavailable instead of as no news", async (_, respond) => {
    const { db, sqlite } = setup();
    try {
      const request = vi.fn<typeof fetch>().mockImplementation(async () => respond());
      await expect(discover(db, "run", now, false, request)).rejects.toThrow("official_source_unavailable");
    } finally { sqlite.close(); }
  });

  it.each([
    ["a challenge page", "<html><body>Checking your browser before accessing fripside.net…</body></html>"],
    ["a redesign without dated links", '<a href="/contents/1124469">FAN MEETING</a>'],
    ["an empty page", ""],
  ])("treats %s on the news index as a layout failure", async (_, body) => {
    const { db, sqlite } = setup();
    try {
      const request = vi.fn<typeof fetch>().mockImplementation(async () => html(body));
      await expect(discover(db, "run", now, false, request)).rejects.toThrow("official_layout_changed");
    } finally { sqlite.close(); }
  });

  it("fails when every candidate article is unreadable", async () => {
    const { db, sqlite } = setup();
    try {
      const request = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith("/news") ? html(index) : html("<main>redesigned</main>"));
      await expect(discover(db, "run", now, false, request)).rejects.toThrow("official_articles_unreadable");
    } finally { sqlite.close(); }
  });

  it("keeps partial article failures as reported errors without failing the run", async () => {
    const { db, sqlite } = setup();
    try {
      const request = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith("/news") ? html(index)
        : String(url).endsWith("1123461") ? html("Forbidden", 403) : html(article));
      const result = await discover(db, "run", now, false, request);
      expect(result.articles.map((item) => item.source_url)).toEqual(["https://fripside.net/contents/1124469"]);
      expect(result.errors).toEqual([{ source_url: "https://fripside.net/contents/1123461", code: "source_temporarily_unavailable" }]);
    } finally { sqlite.close(); }
  });

  it("still reports no work when every readable article is unchanged", async () => {
    const { db, sqlite } = setup();
    try {
      const request = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith("/news") ? html(index) : html(article));
      await discover(db, "run", now, false, request);
      sqlite.prepare("UPDATE official_sync_sources SET processed_hash=content_hash").run();
      expect(await discover(db, "run", now, false, request)).toEqual({ articles: [], errors: [] });
    } finally { sqlite.close(); }
  });
});
