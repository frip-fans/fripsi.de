// Launch through check.py. The supervisor discards both output streams, even on a worker crash.
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const origin = "https://staging.fripsi.de";

export async function verifyPage(context, path, selector) {
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password) return false;
  const page = await context.newPage();
  const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 15000 });
  if (!response?.ok() || response.request().redirectedFrom() || page.url() !== url.href) return false;
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 8000 });
  return page.url() === url.href;
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const [cookie, path, selector] = JSON.parse(Buffer.concat(chunks));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block" });
    await context.addCookies([{ name: "CF_Authorization", value: cookie, url: origin,
      httpOnly: true, secure: true, sameSite: "Strict" }]);
    return await verifyPage(context, path, selector);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(ok => { process.exitCode = ok ? 0 : 1; }).catch(() => { process.exitCode = 1; });
}
