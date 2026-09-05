// Collect only public jacket metadata, never download or commit image binaries.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const periods = ["2003-2013", "2014-2020", "2021-2026"];
const releases = (await Promise.all(periods.map(async (period) =>
  JSON.parse(await readFile(`data/research/discography-${period}.json`, "utf8")).releases))).flat();
const entries = [...new Map(releases.map((release) => [release.source_url, release])).values()];
const browser = await chromium.launch({ headless: true });
const covers = [];
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const entry of entries) {
    const response = await context.request.get(entry.source_url, { timeout: 45000 });
    if (!response.ok()) throw new Error(`${response.status()}: ${entry.source_url}`);
    const result = await page.evaluate(({ html, source }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const root = doc.querySelector(".discography-wrapp");
      if (!root) throw new Error(`No discography detail: ${source}`);
      const clean = (value) => (value ?? "").replace(/\s+/g, " ").trim();
      const imageUrl = (root) => {
        const img = root.querySelector("img[data-src], img");
        const src = img?.getAttribute("data-src") || img?.getAttribute("src");
        if (!src || /dummy|noimage|no_image/i.test(src)) return null;
        const url = new URL(src, source);
        if (url.origin !== "https://fripside.net" || !url.pathname.startsWith("/s3/skiyaki/uploads/")) throw new Error(`Unexpected image origin: ${url}`);
        return url.href;
      };
      return {
        cover_url: imageUrl(root),
        editions: [...root.querySelectorAll(".music-product-details")].map((product) => ({
          title: clean(product.querySelector(".music-product-title")?.textContent),
          catalog_number: clean(product.querySelector(".music-product-number")?.textContent),
          cover_url: imageUrl(product),
        })),
      };
    }, { html: await response.text(), source: entry.source_url });
    covers.push({ source_url: entry.source_url, title: entry.title, release_date: entry.release_date, ...result });
    console.log(`${covers.length}/${entries.length} ${entry.title}: ${result.editions.filter((edition) => edition.cover_url).length} edition covers`);
  }
  const urls = [...new Set(covers.flatMap((entry) => [entry.cover_url, ...entry.editions.map((edition) => edition.cover_url)]).filter(Boolean))];
  for (const url of urls) {
    const response = await context.request.get(url, { timeout: 45000 });
    if (!response.ok() || !response.headers()["content-type"]?.startsWith("image/")) throw new Error(`Image unavailable: ${url}`);
  }
  const output = process.argv[2] || "data/research/fripside-official-covers.json";
  await writeFile(output, JSON.stringify({ checked_at: new Date().toISOString(), source: "https://fripside.net/discography", policy: "Edition images are matched by catalog number. For merged audio editions prefer a matching regular edition; otherwise use the first matching edition. Main artwork is used only for releases without edition-specific artwork.", image_count: urls.length, releases: covers }, null, 2) + "\n");
  console.log(`Verified ${urls.length} images; wrote ${output}`);
} finally { await browser.close(); }
