import { ServiceError } from "@frip-fan/core";
import { expect, it } from "vitest";
import { jsonError, readInput } from "../pages/api/admin/chat";

const post = (body: unknown) => new Request("https://example.test/api/admin/chat", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

it("accepts a trimmed message and rejects empty, oversized or malformed input", async () => {
  expect(await readInput(post({ input: "  把时间改成 17:00  " }))).toEqual({ input: "把时间改成 17:00", images: [] });
  await expect(readInput(post({ input: "   " }))).rejects.toThrow(ServiceError);
  await expect(readInput(post({ input: 42 }))).rejects.toThrow(ServiceError);
  await expect(readInput(post({ input: "x".repeat(4001) }))).rejects.toThrow(ServiceError);
  await expect(readInput(new Request("https://example.test/api/admin/chat", { method: "POST", body: "not json" })))
    .rejects.toThrow(ServiceError);
});

it("returns known service errors and hides everything else", async () => {
  const known = await jsonError(new ServiceError("chat_session_expired", "聊天会话已结束，请开始新会话", 409)).json() as any;
  expect(known.error).toEqual({ code: "chat_session_expired", message: "聊天会话已结束，请开始新会话" });

  const response = jsonError(new Error("openai_http_401: sk-live-secret leaked in provider message"));
  expect(response.status).toBe(500);
  const hidden = await response.json() as any;
  expect(hidden.error).toEqual({ code: "internal_error", message: "请求失败" });
});

it("accepts images with or without text and rejects what is not an allowed image", async () => {
  const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0));
  const alone = await readInput(post({ images: [png] }));
  expect(alone.input).toBe("");
  expect(alone.images).toHaveLength(1);
  expect(alone.images[0]).toMatchObject({ type: "image/png", bytes: 12, base64: png });
  expect(alone.images[0]!.id).toMatch(/^[0-9a-f-]{36}$/);

  // The type comes from the bytes, so a script labelled as an image does not pass.
  await expect(readInput(post({ input: "看图", images: [btoa("<svg onload=alert(1)>")] }))).rejects.toThrow(ServiceError);
  await expect(readInput(post({ input: "看图", images: ["not base64!"] }))).rejects.toThrow(ServiceError);
  await expect(readInput(post({ input: "看图", images: "nope" }))).rejects.toThrow(ServiceError);
  await expect(readInput(post({ input: "看图", images: Array(5).fill(png) }))).rejects.toThrow(ServiceError);
  await expect(readInput(post({ input: "看图", images: ["A".repeat(2_000_004)] }))).rejects.toThrow(ServiceError);
});
