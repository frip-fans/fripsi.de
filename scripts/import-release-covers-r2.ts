import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadOfficialCover } from "../packages/core/src/release-media";
// @ts-expect-error The existing import generator is maintained as JavaScript.
import { coverUpdateSql } from "./build-release-cover-import.mjs";

const runFile = promisify(execFile);
const args = process.argv.slice(2);
const environment = args[args.indexOf("--environment") + 1];
if (!args.includes("--environment") || !["local", "staging", "production"].includes(environment)) {
  throw new Error("Usage: tsx scripts/import-release-covers-r2.ts --environment local|staging|production [--upload]");
}
const upload = args.includes("--upload");
const bucket = `frip-fan-media-${environment === "local" ? "dev" : environment === "production" ? "prod" : "staging"}`;
const mediaDir = resolve("data/raw/release-covers");
await mkdir(mediaDir, { recursive: true });
const report = JSON.parse(await readFile("data/reports/fripside-release-covers.json", "utf8")) as { matched: CoverRecord[] };
interface CoverRecord { release_slug: string; release_date: string; source_url: string; cover_url: string }
interface Media { key: string; cover_url: string; original_url: string; contentType: string; file: string; bytes: number }
const images = new Map<string, Media>();
for (const record of report.matched) {
  if (images.has(record.cover_url)) continue;
  const image = await downloadOfficialCover(record.cover_url);
  const file = resolve(mediaDir, image.key.slice("covers/".length));
  await writeFile(file, image.bytes);
  images.set(record.cover_url, { key: image.key, cover_url: image.cover_url, original_url: image.original_url, contentType: image.contentType, file, bytes: image.bytes.length });
}
const unique = [...new Map([...images.values()].map((image) => [image.key, image])).values()];
const manifest = report.matched.map((record) => ({ ...record, ...images.get(record.cover_url)!, original_url: record.cover_url }));
await writeFile(resolve(mediaDir, "manifest.json"), JSON.stringify({ generated_at: new Date().toISOString(), images: unique, releases: manifest }, null, 2) + "\n");
// Keep public provenance portable; image binaries and local paths stay ignored.
await writeFile("data/research/fripside-r2-covers.json", JSON.stringify({
  source: "https://fripside.net/discography",
  releases: manifest.map(({ file: _file, ...record }) => record),
}, null, 2) + "\n");
console.log(`Prepared ${unique.length} objects (${unique.reduce((sum, image) => sum + image.bytes, 0)} bytes) for ${manifest.length} releases.`);
if (upload) {
  const location = environment === "local" ? ["--local", "--persist-to", resolve("apps/web/.wrangler/state")] : ["--remote"];
  const config = ["--config", resolve("apps/web/wrangler.jsonc"), ...(environment === "local" ? [] : ["--env", environment])];
  const wrangler = resolve("node_modules/wrangler/bin/wrangler.js");
  const env = { ...process.env, XDG_CONFIG_HOME: resolve(".cache/xdg") };
  let completed = 0;
  // Bound concurrency to avoid saturating R2 or spawning a process per image at once.
  let cursor = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (cursor < unique.length) {
      const image = unique[cursor++];
      const objectPath = `${bucket}/${image.key}`;
      const uploaded = await runFile(process.execPath, [wrangler, "r2", "object", "put", objectPath, "--file", image.file, "--content-type", image.contentType, "--cache-control", "public, max-age=31536000, immutable", ...location, ...config], { env });
      if (!uploaded.stdout.includes("Upload complete")) throw new Error(`Upload was not confirmed for ${image.key}`);
      const readback = `${image.file}.${environment}.verify`;
      await runFile(process.execPath, [wrangler, "r2", "object", "get", objectPath, "--file", readback, ...location, ...config], { env });
      const actual = createHash("sha256").update(await readFile(readback)).digest("hex");
      if (actual !== image.key.slice("covers/".length).split(".")[0]) throw new Error(`R2 readback mismatch for ${image.key}`);
      console.log(`${++completed}/${unique.length} verified in ${bucket}`);
    }
  }));
  const output = resolve(`data/normalized/fripside-release-covers-${environment}.sql`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `-- Target: ${environment}; verified bucket: ${bucket}. Apply migration 0007 before this content patch.\n` + manifest.map(coverUpdateSql).join("\n") + "\n");
  await writeFile(resolve(mediaDir, `receipt-${environment}.json`), JSON.stringify({ verified_at: new Date().toISOString(), bucket, objects: unique.length, releases: manifest.length, sql: output }, null, 2) + "\n");
  console.log(`R2 upload/readback complete. Prepared ${output}; no D1 changes were executed.`);
}
