import { chromium } from "playwright";

const baseUrl = process.env.VISUAL_BASE_URL || "http://127.0.0.1:4321";
const outputPath = process.env.VISUAL_OUTPUT || "/tmp/frip-fan-home.png";
const cdpUrl = process.env.VISUAL_CDP_URL;
const [viewportWidth, viewportHeight] = (process.env.VISUAL_VIEWPORT || "1440x1000")
  .split("x")
  .map(Number);
const browser = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : await chromium.launch({ headless: true });
const context = cdpUrl
  ? browser.contexts()[0]
  : await browser.newContext({ viewport: { width: viewportWidth, height: viewportHeight }, deviceScaleFactor: 1 });

if (!context) throw new Error("Playwright could not create or find a browser context.");

await context.addCookies([{
  name: "frip_fan_official_notice",
  value: "yes",
  url: baseUrl
}]);

const page = context.pages()[0] || await context.newPage();
await page.setViewportSize({ width: viewportWidth, height: viewportHeight });
await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const background = await page.locator(".moon-backdrop").evaluate((element) => {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return {
    backgroundImage: style.backgroundImage,
    filter: style.filter,
    opacity: style.opacity,
    zIndex: style.zIndex,
    size: `${Math.round(rect.width)}x${Math.round(rect.height)}`
  };
});
const lyricRotators = await page.locator("[data-lyric-rotator]").count();

if (!background.backgroundImage.includes("A_New_View_of_the_Moon")) {
  throw new Error("The moon background image is not present in the computed style.");
}
if (lyricRotators !== 1) throw new Error(`Expected one lyric rotator, found ${lyricRotators}.`);

await page.screenshot({ path: outputPath, fullPage: true });
console.log(JSON.stringify({ url: page.url(), outputPath, viewport: `${viewportWidth}x${viewportHeight}`, lyricRotators, background }, null, 2));
await browser.close();
