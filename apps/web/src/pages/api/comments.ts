import { CommentError, createComment, listComments, parseCommentThread } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { clientAddress, sameOrigin, sourceHash, verifyTurnstile } from "../../lib/comment-request";
import { getEnv } from "../../lib/env";
import { getLocale } from "../../lib/i18n";

// Never cached: someone who just posted must see their comment on the next read.
const headers = { "cache-control": "no-store" };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });

export const GET: APIRoute = async ({ url }) => {
  const thread = parseCommentThread(url.searchParams.get("thread"));
  if (!thread) return failure("invalid_thread", 400);
  const before = url.searchParams.get("before");
  if (before !== null && !/^\d{1,15}$/.test(before)) return failure("invalid_cursor", 400);
  try {
    return Response.json(await listComments(getEnv().DB, thread, { before: before ? Number(before) : null }), { headers });
  } catch (error) {
    console.error(JSON.stringify({ message: "comment list failed", error: error instanceof Error ? error.message : String(error) }));
    return failure("comments_unavailable", 500);
  }
};

export const POST: APIRoute = async ({ request, clientAddress: socketAddress }) => {
  if (!sameOrigin(request)) return failure("bad_origin", 403);
  if (Number(request.headers.get("content-length") ?? 0) > 16 * 1024) return failure("invalid_body", 413);
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    input = parsed as Record<string, unknown>;
  } catch {
    return failure("invalid_request", 400);
  }
  // Visitors never see this field. Report success so a script filling it learns nothing.
  if (typeof input.website === "string" && input.website) return Response.json({ comment: null }, { status: 201, headers });

  const env = getEnv();
  const address = clientAddress(request, socketAddress);
  try {
    if (!(await verifyTurnstile(env, input.turnstile_token, address))) return failure("verification_failed", 403);
    const comment = await createComment(env.DB, {
      thread: input.thread, name: input.name, body: input.body, parent_id: input.parent_id, locale: getLocale(request),
    }, await sourceHash(env, address));
    return Response.json({ comment }, { status: 201, headers });
  } catch (error) {
    if (error instanceof CommentError) return failure(error.code, error.status);
    console.error(JSON.stringify({ message: "comment post failed", error: error instanceof Error ? error.message : String(error) }));
    return failure("comments_unavailable", 500);
  }
};
