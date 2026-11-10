import { ServiceError } from "@frip-fan/core";
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

export async function readInput(request: Request): Promise<string> {
  const body = await request.json().catch(() => null) as { input?: unknown } | null;
  const input = typeof body?.input === "string" ? body.input.trim() : "";
  if (!input) throw new ServiceError("invalid_input", "请输入内容", 400);
  if (input.length > MAX_INPUT) throw new ServiceError("invalid_input", `单条输入不能超过 ${MAX_INPUT} 字`, 400);
  return input;
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const session = await startChat(locals.actor!, await readInput(request));
    return Response.json({ session_id: session.id, expires_at: session.expires_at });
  } catch (error) { return jsonError(error); }
};
