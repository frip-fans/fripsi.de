#!/usr/bin/env node
// Crops the site's moon backdrop to the 1200x630 card that link previews expect.
// Run after changing the backdrop: node scripts/build-og-image.mjs
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = fileURLToPath(new URL("../images/A_New_View_of_the_Moon.jpg", import.meta.url));
const target = fileURLToPath(new URL("../apps/web/public/og-cover.jpg", import.meta.url));

await sharp(source)
  .resize(1200, 630, { fit: "cover", position: "centre" })
  .jpeg({ quality: 82, progressive: true, mozjpeg: true })
  .toFile(target);

const { size } = await sharp(target).metadata();
console.log(`wrote ${target} (${Math.round((size ?? 0) / 1024)} KB)`);
