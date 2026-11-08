import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run against a local web server with at least one public event in the selected year.
const base = process.env.VISUAL_BASE_URL || "http://127.0.0.1:4325";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.VISUAL_EXECUTABLE_PATH ? { executablePath: process.env.VISUAL_EXECUTABLE_PATH } : {}),
});
const results = [];
const listUrl = (lang) => {
  const url = new URL("/calendar", base);
  url.searchParams.set("view", "list");
  url.searchParams.set("lang", lang);
  if (process.env.VISUAL_EVENT_YEAR) url.searchParams.set("year", process.env.VISUAL_EVENT_YEAR);
  return url.href;
};

try {
  for (const [lang, width] of [["zh-CN", 390], ["en", 320], ["ja", 390], ["zh-TW", 430]]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const load = async () => {
      await page.goto(listUrl(lang));
      await page.locator("[data-event-item]:not([hidden]) .event-card").first().waitFor();
    };
    const card = () => page.locator("[data-event-item]:not([hidden]) .event-card").first();
    const focusSearch = async () => {
      const query = Array.from(await card().locator("h3 a").textContent()).slice(0, 24).join("");
      await page.locator("[data-event-search-input]").fill(query);
      await card().waitFor();
    };
    const tapCard = async (area) => {
      const item = card();
      await item.scrollIntoViewIfNeeded();
      const href = await item.locator("h3 a").evaluate((e) => e.href);
      const box = await item.boundingBox();
      assert.ok(box);
      const point = { x: box.x + 35, y: area === "details" ? box.y + box.height - 24 : box.y + 20 };
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("a")?.href, point);
      assert.equal(hit, href, "the whole visible card must hit its native event link");
      await Promise.all([page.waitForURL(href), page.touchscreen.tap(point.x, point.y)]);
      assert.equal(page.url(), href);
    };

    await load();
    await card().hover();
    assert.equal(await card().evaluate((e) => getComputedStyle(e).transform), "none", "touch devices must not move the link on synthetic hover");
    const touch = await page.locator("[data-agenda-return]").evaluate((e) => getComputedStyle(e).touchAction);
    assert.equal(touch, "manipulation");
    assert.ok(await page.locator("[data-event-search-input]").evaluate((e) => parseFloat(getComputedStyle(e).fontSize) >= 16));
    await page.locator("[data-agenda-return]").tap();
    await page.waitForURL((url) => url.searchParams.get("view") === "calendar");

    for (const focused of [false, true]) {
      await load();
      if (focused) await focusSearch();
      const href = await page.locator("[data-agenda-return]").evaluate((e) => e.href);
      await Promise.all([page.waitForURL(href), page.locator("[data-agenda-return]").tap()]);
      for (const area of ["header", "details"]) {
        await load();
        if (focused) await focusSearch();
        await tapCard(area);
        await page.goBack();
        await card().waitFor();
        await tapCard(area);
      }
    }

    await load();
    await page.locator("[data-filter-toggle]").tap();
    assert.equal(await page.locator("[data-filter-panel]").evaluate((e) => e.hidden), false);
    // The first outside tap both dismisses the popover and follows the return link.
    const href = await page.locator("[data-agenda-return]").evaluate((e) => e.href);
    await Promise.all([page.waitForURL(href), page.locator("[data-agenda-return]").tap()]);

    await load();
    await page.locator("[data-sort-toggle]").tap();
    await page.touchscreen.tap(5, 180);
    assert.equal(await page.locator("[data-sort-panel]").evaluate((e) => e.hidden), true);
    await tapCard("header");
    const detailBack = page.locator("a.back");
    const detailBackHref = await detailBack.evaluate((e) => e.href);
    await Promise.all([page.waitForURL(detailBackHref), detailBack.tap()]);
    results.push({ lang, width, detailBack: "passed", firstTapReturn: "passed", firstTapCard: "passed", focusedSearch: "passed", browserBack: "passed", popovers: "passed" });
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 844 } });
  const page = await context.newPage();
  await page.goto(listUrl("en"));
  const card = page.locator("[data-event-item]:not([hidden]) .event-card").first();
  await card.hover();
  await page.waitForFunction(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector("[data-event-item]:not([hidden]) .event-card")).transform).m42 < -1.5);
  const link = card.locator("h3 a");
  const href = await link.evaluate((e) => e.href);
  await link.focus();
  await Promise.all([page.waitForURL(href), page.keyboard.press("Enter")]);
  results.push({ desktopHover: "passed", keyboardEnter: "passed" });
  await context.close();
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
