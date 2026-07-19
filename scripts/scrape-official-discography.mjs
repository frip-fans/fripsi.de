import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const origin = "https://fripside.net";
const outputPath = resolve(process.argv[2] || "data/raw/fripside-official-discography.json");

function compact(value) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

const browser = await chromium.launch({ headless: true });
try {
  const listingPage = await browser.newPage();
  const entries = [];
  for (let number = 1; number <= 4; number += 1) {
    const url = number === 1 ? `${origin}/discography` : `${origin}/discography/page/${number}`;
    await listingPage.goto(url, { waitUntil: "domcontentloaded" });
    const pageEntries = await listingPage.locator(".music-list-item").evaluateAll((items) => items.map((item) => {
      const anchor = item.querySelector("a");
      return {
        source_url: anchor ? new URL(anchor.getAttribute("href") || "", location.origin).href : "",
        official_type: item.querySelector(".music-category")?.textContent?.trim() || "",
        release_date: item.querySelector("time")?.getAttribute("datetime") || "",
        title: item.querySelector(".music-list-title")?.textContent?.trim() || "",
      };
    }));
    entries.push(...pageEntries);
  }
  await listingPage.close();

  const releases = await mapConcurrent(entries, 2, async (entry) => {
    const page = await browser.newPage();
    try {
      let loaded = false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await page.goto(entry.source_url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        } catch {
          // A later attempt may recover from a transient upstream timeout.
        }
        if (await page.locator(".discography-wrapp").count()) {
          loaded = true;
          break;
        }
        await page.waitForTimeout(attempt * 1_000);
      }
      if (!loaded) return { ...entry, subtitle: "", editions: [], scrape_error: "Detail container was not available after three attempts." };
      const detail = await page.locator(".discography-wrapp").evaluate((root) => {
        const clean = (value) => (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
        return {
          subtitle: clean(root.querySelector(".music-subtitle")?.textContent),
          editions: Array.from(root.querySelectorAll(".music-product-details")).map((product) => ({
            name: clean(product.querySelector(".music-product-option-text")?.textContent),
            catalog_number: clean(product.querySelector(".music-product-number")?.textContent),
            discs: Array.from(product.querySelectorAll(".music-product-disc")).map((disc, discIndex) => ({
              media: clean(disc.querySelector(".disc-name")?.textContent) || "unspecified",
              number: discIndex + 1,
              tracks: Array.from(disc.querySelectorAll(".track-list-item")).map((track, trackIndex) => ({
                number: Number.parseInt(clean(track.querySelector(".track-no")?.textContent), 10) || trackIndex + 1,
                title: clean(track.querySelector(".track-title")?.textContent),
              })),
            })),
          })),
        };
      });
      return {
        ...entry,
        official_type: compact(entry.official_type),
        title: compact(entry.title),
        subtitle: compact(detail.subtitle),
        editions: detail.editions,
      };
    } finally {
      await page.close();
    }
  });

  const report = {
    generated_at: new Date().toISOString(),
    source: `${origin}/discography`,
    releases,
    counts: {
      listed: releases.length,
      audio: releases.filter((release) => !/dvd|blu-ray/i.test(release.official_type)).length,
      video: releases.filter((release) => /dvd|blu-ray/i.test(release.official_type)).length,
      without_structured_tracks: releases.filter((release) => !release.editions.some((edition) => edition.discs.some((disc) => disc.tracks.length))).map((release) => release.source_url),
    },
  };
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`已抓取 ${releases.length} 条 Discography，写入 ${outputPath}`);
  console.log(JSON.stringify(report.counts));
} finally {
  await browser.close();
}
