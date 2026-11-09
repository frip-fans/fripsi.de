import { defineConfig, sessionDrivers } from "astro/config";
import node from "@astrojs/node";

export default defineConfig({
  output: "server",
  // Fetch a page ahead of a navigation only where a link opts in: ClientRouter
  // would otherwise enable prefetching for every link it sees, and this site is
  // served from a single small host. `prefetchAll: false` is set explicitly so
  // it wins over that default rather than falling back to it.
  prefetch: { prefetchAll: false, defaultStrategy: "tap" },
  devToolbar: { enabled: false },
  integrations: [{
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
  }],
  // Self-hosted Node standalone server; the deployment packages this directory.
  adapter: node({ mode: "standalone", experimentalDisableStreaming: true, bodySizeLimit: 10 * 1024 * 1024 }),
  outDir: "./dist-node",
  image: { service: { entrypoint: "astro/assets/services/noop" } },
  // Authentication is handled by Cloudflare Access; Astro sessions are unused,
  // so an in-process driver keeps the adapter from configuring a session store.
  session: { driver: sessionDrivers.lruCache() },
  trailingSlash: "never",
  security: { allowedDomains: [
    { hostname: "fripsi.de", protocol: "https" },
    { hostname: "staging.fripsi.de", protocol: "https" },
    { hostname: "mcp-staging.fripsi.de", protocol: "https" },
    { hostname: "localhost", protocol: "http" },
    { hostname: "127.0.0.1", protocol: "http" },
  ] },
  vite: {
    build: {
      // The production CSP only permits same-origin scripts. Keep Astro from
      // inlining small client scripts so browsers can execute them under that
      // policy (the site notice and lyric rotator both rely on these scripts).
      assetsInlineLimit: 0,
      cssMinify: true
    }
  }
});
