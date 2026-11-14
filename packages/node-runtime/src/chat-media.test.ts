import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { localChatMedia } from "./chat-media";

const session = "11111111-2222-4333-8444-555555555555";
const file = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png";

it("stores chat images per session and removes them with it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "frip-chat-media-"));
  const media = localChatMedia(directory);
  const data = new Uint8Array([1, 2, 3]);
  await media.put(session, file, data);
  expect(await media.get(session, file)).toEqual(data);
  expect((await stat(join(directory, session, file))).mode & 0o777).toBe(0o600);
  expect(await readdir(join(directory, session))).toEqual([file]);

  await media.removeSession(session);
  expect(await media.get(session, file)).toBeNull();
  expect(await readdir(directory)).toEqual([]);
});

it("refuses names that could leave the session folder", async () => {
  const media = localChatMedia(await mkdtemp(join(tmpdir(), "frip-chat-media-")));
  await expect(media.put("..", file, new Uint8Array([1]))).rejects.toThrow(TypeError);
  await expect(media.put(session, "../escape.png", new Uint8Array([1]))).rejects.toThrow(TypeError);
  await expect(media.get(session, "../../site.sqlite")).rejects.toThrow(TypeError);
  await expect(media.removeSession("../media")).rejects.toThrow(TypeError);
  await expect(media.put(session, file, new Uint8Array(1_500_001))).rejects.toThrow(TypeError);
});
