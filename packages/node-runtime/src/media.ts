import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, rename, stat, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { MAX_COVER_BYTES, COVER_PATH_PATTERN } from "@frip-fan/core";

export function localMedia(directory: string): R2Bucket {
  const root = resolve(directory);
  const path = (key: string) => {
    if (!COVER_PATH_PATTERN.test(`/media/${key}`)) throw new TypeError("Invalid cover storage key");
    return resolve(root, key);
  };
  const head = async (key: string) => {
    const file = path(key);
    try {
      const info = await stat(file);
      if (!info.isFile()) return null;
      const etag = key.split("/").at(-1)!.split(".")[0];
      const contentType = key.endsWith(".jpg") ? "image/jpeg" : `image/${key.split(".").at(-1)}`;
      return { key, size: info.size, etag, httpEtag: `"${etag}"`, uploaded: info.mtime,
        httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" } };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  };
  return {
    head,
    async get(key: string) {
      const object = await head(key);
      if (!object) return null;
      return { ...object, body: Readable.toWeb(createReadStream(path(key))),
        async arrayBuffer() { const bytes = await readFile(path(key)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
    },
    async put(key: string, value: Uint8Array | ArrayBuffer, options?: { customMetadata?: Record<string, string> }) {
      const file = path(key);
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_COVER_BYTES) throw new TypeError("Invalid cover payload");
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (!key.includes(`/${digest}.`)) throw new TypeError("Cover key does not match its content hash");
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" }); await rename(temporary, file); }
      finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
      if (options?.customMetadata) await writeFile(`${file}.metadata.json`, JSON.stringify(options.customMetadata), { mode: 0o600 });
      return head(key);
    },
    async delete(key: string) { await unlink(path(key)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); },
  } as unknown as R2Bucket;
}
