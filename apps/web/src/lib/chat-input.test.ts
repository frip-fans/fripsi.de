import { ServiceError } from "@frip-fan/core";
import { expect, it } from "vitest";
import { jsonError, readInput } from "../pages/api/admin/chat";

const post = (body: unknown) => new Request("https://example.test/api/admin/chat", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

it("accepts a trimmed message and rejects empty, oversized or malformed input", async () => {
  expect(await readInput(post({ input: "  把时间改成 17:00  " }))).toBe("把时间改成 17:00");
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
