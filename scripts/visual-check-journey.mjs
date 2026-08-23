import { chromium } from "playwright";

const baseUrl = process.env.VISUAL_BASE_URL || "http://127.0.0.1:4321";
const browser = await chromium.launch({ headless: true });

async function check(viewport, outputPath) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addCookies([{ name: "frip_fan_official_notice", value: "yes", url: baseUrl }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const text = message.text();
    const astroDevToolbarCsp = text.includes("Executing inline script violates") && text.includes("Content Security Policy");
    const cloudflareBeaconCsp = text.includes("static.cloudflareinsights.com/beacon.min.js") && text.includes("Content Security Policy");
    if (message.type() === "error" && !astroDevToolbarCsp && !cloudflareBeaconCsp) errors.push(`console: ${text}`);
  });
  await page.goto(`${baseUrl}/journey`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-live-journey][data-ready='true']").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1200);

  const events = Number(await page.locator("[data-summary-field='events']").textContent());
  const range = page.locator("[data-journey-range]");
  const max = Number(await range.getAttribute("max"));
  const initialProgress = await page.locator("[data-journey-progress]").textContent();
  const location = await page.locator("[data-current-venue]").textContent();
  const tileCount = await page.locator(".leaflet-tile-loaded").count();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (events < 1 || max < 1) throw new Error(`Journey data is empty: events=${events}, max=${max}`);
  if (!location?.trim() || location === "—") throw new Error("Current journey location is empty");
  if (tileCount < 1) throw new Error("No OpenStreetMap tiles loaded");
  if (overflow > 1) throw new Error(`Horizontal overflow: ${overflow}px`);

  await range.fill("0");
  await page.locator("[data-journey-play]").click();
  await page.waitForTimeout(1100);
  const playedProgress = await page.locator("[data-journey-progress]").textContent();
  if (playedProgress === initialProgress || playedProgress?.startsWith("1 /")) {
    throw new Error(`Journey playback did not advance: ${initialProgress} -> ${playedProgress}`);
  }
  await page.locator("[data-journey-play]").click();
  await page.screenshot({ path: outputPath, fullPage: true });
  await context.close();
  return { viewport, outputPath, events, stops: max + 1, tileCount, location, playedProgress, errors };
}

const results = [
  await check({ width: 1440, height: 1000 }, "/tmp/frip-journey-desktop.png"),
  await check({ width: 390, height: 844 }, "/tmp/frip-journey-mobile.png"),
];
await browser.close();
if (results.some((result) => result.errors.length)) throw new Error(JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
