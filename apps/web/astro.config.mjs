import { defineConfig, sessionDrivers } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import { fileURLToPath } from "node:url";
const selfHosted = process.env.FRIP_RUNTIME === "node";

export default defineConfig({
  output: "server",
  // Fetch a page ahead of a navigation only where a link opts in: ClientRouter
  // would otherwise enable prefetching for every link it sees, and this site is
  // served from a single small host. `prefetchAll: false` is set explicitly so
  // it wins over that default rather than falling back to it.
  prefetch: { prefetchAll: false, defaultStrategy: "tap" },
  devToolbar: { enabled: false },
  integrations: selfHosted ? [{
    name: "node-workspace-dependencies",
    hooks: {
      "astro:config:setup": ({ command, updateConfig }) => {
        // Vite's dev module runner must let Node load third-party CommonJS.
        // Release builds still bundle dependencies for the standalone artifact.
        updateConfig({ vite: { ssr: { noExternal: command === "dev"
          ? ["@frip-fan/core", "@frip-fan/node-runtime", "@frip-fan/mcp"]
          : true } } });
      },
    },
  }] : [],
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
    { hostname: "mcp-staging.fripsi.de", protocol: "https" },
    { hostname: "localhost", protocol: "http" },
    { hostname: "127.0.0.1", protocol: "http" },
  ] } : undefined,
  vite: {
    resolve: { alias: selfHosted ? { "#runtime-env": fileURLToPath(new URL("./src/lib/env-node.ts", import.meta.url)), "#public-cache": fileURLToPath(new URL("./src/lib/public-cache-node.ts", import.meta.url)), "#runtime-mcp": fileURLToPath(new URL("./src/lib/mcp-node.ts", import.meta.url)) } : {} },
    build: {
      // The production CSP only permits same-origin scripts. Keep Astro from
      // inlining small client scripts so browsers can execute them under that
      // policy (the site notice and lyric rotator both rely on these scripts).
      assetsInlineLimit: 0,
      cssMinify: true
    }
  }
});
