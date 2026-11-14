import { ServiceError, parseChatImages, type ChatImage } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { startChat } from "../../../lib/chat";

const MAX_INPUT = 4000;

export function jsonError(error: unknown): Response {
  const known = error instanceof ServiceError;
  // Upstream and internal failures must not echo provider messages or stack traces.
  const code = known ? error.code : "internal_error";
  const message = known ? error.message : "请求失败";
  return Response.json({ error: { code, message } }, { status: known ? error.status : 500 });
}

/** A message is its text, its images, or both; images alone are a complete message. */
export async function readInput(request: Request): Promise<{ input: string; images: ChatImage[] }> {
  const body = await request.json().catch(() => null) as { input?: unknown; images?: unknown } | null;
  const input = typeof body?.input === "string" ? body.input.trim() : "";
  if (input.length > MAX_INPUT) throw new ServiceError("invalid_input", `单条输入不能超过 ${MAX_INPUT} 字`, 400);
  const images = parseChatImages(body?.images);
  if (!input && !images.length) throw new ServiceError("invalid_input", "请输入内容", 400);
  return { input, images };
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.clone().json().catch(() => null) as { model?: unknown } | null;
    const model = typeof body?.model === "string" ? body.model.trim() : "";
    if (!model) throw new ServiceError("invalid_model", "请选择模型", 400);
    const { input, images } = await readInput(request);
    const session = await startChat(locals.actor!, input, model, new Date(), images);
    return Response.json({ session_id: session.id, model: session.model, expires_at: session.expires_at });
  } catch (error) { return jsonError(error); }
};
