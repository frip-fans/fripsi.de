// Synthetic Access session. Fulfil all requests locally; no connection to staging.
import { chromium } from "playwright";
import { verifyPage } from "../browser.mjs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const [cookie, path, selector] = JSON.parse(Buffer.concat(chunks));
if (process.env.FRIP_STAGING_ACCESS_CLIENT_SECRET || process.env.DEBUG || process.env.PWDEBUG) process.exit(2);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const origin = "https://staging.fripsi.de";
  await context.addCookies([{ name: "CF_Authorization", value: cookie, url: origin, secure: true, httpOnly: true }]);
  await context.route("**/*", async route => {
    if (await route.request().headerValue("cookie") !== "CF_Authorization=" + cookie) {
      return route.fulfill({ status: 403 });
    }
    if (path === "/close") {
      // Deliberately leave the navigation unresolved and close its context.
      await context.close();
      return;
    }
    if (path === "/hang") return;
    return route.fulfill({ contentType: "text/html", body: "<main><h1>Fixture</h1></main>" });
  });
  process.exitCode = await verifyPage(context, path, selector) ? 0 : 1;
} catch (error) {
  // Exercise a noisy third-party failure carrying a session cookie.
  console.error(error, cookie);
  process.exitCode = 1;
} finally {
  await browser.close();
}
