import { build } from "esbuild";
await build({ entryPoints: ["apps/sync/src/node.ts"], outfile: "apps/web/dist-node/server/sync-cli.mjs",
  bundle: true, platform: "node", target: "node24", format: "esm", sourcemap: false });
