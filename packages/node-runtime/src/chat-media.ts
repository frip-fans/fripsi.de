import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { CHAT_IMAGE_MAX_BYTES, isChatAttachmentPath, type ChatMediaStore } from "@frip-fan/core";

/**
 * Chat images on local disk, one folder per session so a transcript's files go with it.
 * This directory is private: nothing serves it but the authenticated admin route.
 */
export function localChatMedia(directory: string): ChatMediaStore {
  const root = resolve(directory);
  const path = (sessionId: string, file: string) => {
    if (!isChatAttachmentPath(sessionId, file)) throw new TypeError("Invalid chat attachment path");
    return resolve(root, sessionId, file);
  };
  return {
    async put(sessionId, file, data) {
      const target = path(sessionId, file);
      if (!(data instanceof Uint8Array) || data.byteLength > CHAT_IMAGE_MAX_BYTES) throw new TypeError("Invalid chat attachment payload");
      await mkdir(resolve(root, sessionId), { recursive: true, mode: 0o700 });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, data, { mode: 0o600, flag: "wx" }); await rename(temporary, target); }
      finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
    },
    async get(sessionId, file) {
      try { return new Uint8Array(await readFile(path(sessionId, file))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    },
    async removeSession(sessionId) {
      // The same uuid check as for files, with a file name that always passes.
      path(sessionId, "00000000-0000-0000-0000-000000000000.jpg");
      await rm(resolve(root, sessionId), { recursive: true, force: true });
    },
  };
}
