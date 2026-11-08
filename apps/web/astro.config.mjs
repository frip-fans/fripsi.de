import { defineConfig, sessionDrivers } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import { fileURLToPath } from "node:url";
const selfHosted = process.env.FRIP_RUNTIME === "node";

export default defineConfig({
  output: "server",
  adapter: selfHosted ? node({ mode: "standalone", experimentalDisableStreaming: true, bodySizeLimit: 10 * 1024 * 1024 }) : cloudflare({ imageService: "passthrough" }),
  outDir: selfHosted ? "./dist-node" : "./dist",
  image: { service: { entrypoint: "astro/assets/services/noop" } },
  // Authentication is handled by Cloudflare Access. We do not use Astro sessions,
  // so keep the adapter from provisioning an otherwise unused KV namespace.
  session: { driver: sessionDrivers.lruCache() },
  trailingSlash: "never",
  security: selfHosted ? { allowedDomains: [
    { hostname: "fripsi.de", protocol: "https" },
    { hostname: "staging.fripsi.de", protocol: "https" },
    { hostname: "localhost", protocol: "http" },
    { hostname: "127.0.0.1", protocol: "http" },
  ] } : undefined,
  vite: {
    resolve: { alias: selfHosted ? { "#runtime-env": fileURLToPath(new URL("./src/lib/env-node.ts", import.meta.url)), "#public-cache": fileURLToPath(new URL("./src/lib/public-cache-node.ts", import.meta.url)), "#runtime-mcp": fileURLToPath(new URL("./src/lib/mcp-node.ts", import.meta.url)) } : {} },
    ssr: { noExternal: selfHosted ? true : undefined },
    build: {
      // The production CSP only permits same-origin scripts. Keep Astro from
      // inlining small client scripts so browsers can execute them under that
      // policy (the site notice and lyric rotator both rely on these scripts).
      assetsInlineLimit: 0,
      cssMinify: true
    }
  }
});
