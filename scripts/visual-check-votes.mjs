import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run against a local web server. Only /api/votes is mocked; the page and its
// browser scripts are served by Astro. No local or remote database is changed.
const baseUrl = process.env.VISUAL_BASE_URL || "http://127.0.0.1:4321";
const outputPath = process.env.VISUAL_OUTPUT || "/tmp/frip-votes-mobile.png";
const browser = await chromium.launch({
  headless: true,
  channel: process.env.VISUAL_BROWSER_CHANNEL || "chrome",
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

const album = { id: "album-main", title: "Fixture Album", type: "album", edition: null };
const single = { id: "single-main", title: "Fixture Single", type: "single", edition: null };
const versions = Array.from({ length: 25 }, (_, index) => {
  const title = `${index === 24 ? "Echo" : "Alpha"} ${String(index).padStart(2, "0")}`;
  return {
    id: `version-${String(index).padStart(2, "0")}`,
    song_slug: `song-${index}`,
    song_title: title,
    title,
    version_label: "original",
    artist_credit: "fripSide",
    search_text: `${title} original fripSide`,
    vote_count: index === 0 ? 4 : 0,
    average: null,
    my_score: null,
    phases: index === 0 ? [2, 3] : index % 2 ? [1] : [3],
    releases: index === 0 ? [album, single] : index % 2 ? [single] : [album],
  };
});
const posts = [];
const errors = [];
let delayedGet = null;
let releasePendingPoll = null;

try {
  await context.addCookies([
    { name: "frip_fan_official_notice", value: "yes", url: baseUrl },
    { name: "frip_fan_locale", value: "en", url: baseUrl },
  ]);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = window.setInterval.bind(window);
    window.setInterval = (callback, milliseconds, ...args) => {
      if (milliseconds === 15000 && typeof callback === "function") {
        window.__votePoll = () => callback(...args);
        return 0;
      }
      return original(callback, milliseconds, ...args);
    };
  });
  await page.route(/\/api\/votes\/?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const vote = request.postDataJSON();
      posts.push(vote);
      assert(vote.score === null || Number.isInteger(vote.score) && vote.score >= 1 && vote.score <= 10);
      const row = versions.find((version) => version.id === vote.versionId);
      assert(row, `Unknown fixture version: ${vote.versionId}`);
      row.my_score = vote.score;
      row.vote_count = vote.versionId === "version-00" ? 4 + Number(vote.score !== null) : Number(vote.score !== null);
      row.average = row.vote_count >= 5 ? Math.round((30 + vote.score) / 5 * 10) / 10 : null;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    assert.equal(request.method(), "GET");
    const snapshot = structuredClone(versions);
    const delay = delayedGet;
    if (delay) {
      delayedGet = null;
      delay.started.resolve();
      await delay.release.promise;
    }
    try {
      await route.fulfill({ json: snapshot });
    } catch (error) {
      // The production script may abort a poll when a vote starts.
      if (!delay || !/closed|abort|cancel|invalid interception/i.test(String(error))) throw error;
    }
  });

  async function ready() {
    await page.locator("[data-vote-id]").first().waitFor();
    await page.waitForFunction(() => typeof window.__votePoll === "function");
  }
  const card = () => page.locator('[data-vote-id="version-00"]');
  async function waitForScore(score) {
    await page.waitForFunction((expected) => {
      const card = document.querySelector('[data-vote-id="version-00"]');
      if (!card || card.querySelector("[data-vote-score]:disabled")) return false;
      const selected = card.querySelector('[data-vote-score][aria-pressed="true"]');
      return expected === null ? selected === null : selected?.getAttribute("data-vote-score") === String(expected);
    }, score);
  }
  async function vote(score, expected = score) {
    const count = posts.length;
    await card().locator(`[data-vote-score="${score}"]`).click();
    await page.waitForFunction(() => !document.querySelector("[data-vote-score]:disabled"));
    assert.equal(posts.length, count + 1, "Every rating click must submit exactly once");
    assert.deepEqual(posts.at(-1), { versionId: "version-00", score: expected });
    await waitForScore(expected);
  }
  async function poll() {
    await page.evaluate(() => window.__votePoll());
  }

  await page.goto(`${baseUrl}/votes`, { waitUntil: "domcontentloaded" });
  await ready();
  assert.equal(await page.locator("[data-vote-id]").count(), 20, "The fixture must exercise pagination");
  assert((await page.locator("[data-vote-id]").evaluateAll((cards) => cards.map((card) => card.querySelectorAll("[data-vote-score]").length))).every((count) => count === 10), "Every card must offer ten scores");
  assert.deepEqual(await card().locator("[data-vote-score]").allTextContents(), Array.from({ length: 10 }, (_, index) => String(index + 1)));
  await vote(10);
  assert.match(await card().locator(".vote-stats").textContent(), /8\.0/);
  await vote(7);
  assert.match(await card().locator(".vote-stats").textContent(), /7\.4/);
  await vote(7, null);
  assert.doesNotMatch(await card().locator(".vote-stats").textContent(), /Average [\d.]/);

  await card().locator(".vote-title").focus();
  await poll();
  assert(await card().locator(".vote-title").evaluate((element) => element === document.activeElement), "Polling must preserve a song link's keyboard focus");
  const pageTwo = page.locator('.music-page-number[data-page="2"]');
  await pageTwo.focus();
  await poll();
  assert(await pageTwo.evaluate((element) => element === document.activeElement), "Polling must preserve pagination focus");

  const delayed = { started: deferred(), release: deferred() };
  releasePendingPoll = delayed.release.resolve;
  delayedGet = delayed;
  await page.evaluate(() => { window.__votePollPending = Promise.resolve(window.__votePoll()); });
  await delayed.started.promise;
  await vote(10);
  delayed.release.resolve();
  releasePendingPoll = null;
  await page.evaluate(() => window.__votePollPending);
  await waitForScore(10);
  assert.equal(await card().locator('[data-vote-score="10"]').getAttribute("aria-pressed"), "true", "An older poll response must not replace a newly saved score");

  await page.locator('[data-vote-choice="initial"][data-value="A–D"]').click();
  await page.locator('[data-vote-choice="phase"][data-value="2"]').click();
  await page.locator('[data-vote-choice="type"][data-value="album"]').click();
  await page.locator("[data-vote-filter='release']").selectOption("album-main");
  assert.equal(await page.locator("[data-vote-id]").count(), 1);
  assert.equal(await page.locator("[data-vote-id]").getAttribute("data-vote-id"), "version-00");
  const filteredUrl = new URL(page.url());
  assert.equal(filteredUrl.searchParams.get("initial"), "A–D");
  assert.equal(filteredUrl.searchParams.get("phase"), "2");
  assert.equal(filteredUrl.searchParams.get("type"), "album");
  assert.equal(filteredUrl.searchParams.get("release"), "album-main");
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready();
  assert.equal(await page.locator("[data-vote-id]").count(), 1);
  assert.equal(await page.locator("[data-vote-filter='release']").inputValue(), "album-main");
  await page.locator("[data-vote-clear]").click();
  assert.equal(await page.locator("[data-vote-id]").count(), 20);
  for (const key of ["initial", "phase", "type", "release"]) assert.equal(new URL(page.url()).searchParams.has(key), false);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await card().locator("[data-vote-score]").count(), 10);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `Mobile page has ${overflow}px of horizontal overflow`);
  await page.screenshot({ path: outputPath, fullPage: true });
  assert.deepEqual(errors, [], "The browser must not report JavaScript errors");
  console.log(JSON.stringify({
    url: page.url(),
    fixtureVersions: versions.length,
    scoreRange: "1–10",
    posts: posts.length,
    checks: ["ten-score-buttons", "save-update-cancel", "five-vote-threshold", "link-focus", "pagination-focus", "vote-during-poll", "ignore-stale-poll", "combined-filters", "reload-filters", "clear-filters", "mobile-overflow"],
    overflow,
    outputPath,
    errors,
  }, null, 2));
} finally {
  releasePendingPoll?.();
  delayedGet?.release.resolve();
  await context.close();
  await browser.close();
}
