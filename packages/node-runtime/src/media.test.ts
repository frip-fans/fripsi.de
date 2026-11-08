import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { localMedia } from "./media";
import { coverResponse } from "../../../apps/web/src/lib/cover-response";

it("serves immutable covers, HEAD and conditional requests without exposing arbitrary paths", async () => {
  const directory = await mkdtemp(join(tmpdir(),"frip-media-"));
  try {
    const bucket = localMedia(directory);
    const bytes = new Uint8Array([0xff,0xd8,0xff,0xe0,0,1,2,3]);
    const file = `${createHash("sha256").update(bytes).digest("hex")}.jpg`;
    await bucket.put(`covers/${file}`, bytes);
    const response = await coverResponse(new Request("https://example.com/media/covers/"+file),file,bucket);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect((await coverResponse(new Request("https://example.com/",{method:"HEAD"}),file,bucket)).headers.get("content-length")).toBe("8");
    expect((await coverResponse(new Request("https://example.com/",{headers:{"if-none-match":response.headers.get("etag")!}}),file,bucket)).status).toBe(304);
    await expect(bucket.get("../.env")).rejects.toThrow("Invalid cover");
    expect((await coverResponse(new Request("https://example.com/"),"../.env",bucket)).status).toBe(404);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
