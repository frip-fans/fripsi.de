import { defineConfig, sessionDrivers } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  // Authentication is handled by Cloudflare Access. We do not use Astro sessions,
  // so keep the adapter from provisioning an otherwise unused KV namespace.
  session: { driver: sessionDrivers.lruCache() },
  trailingSlash: "never",
  vite: {
    build: {
      cssMinify: true
    }
  }
});
