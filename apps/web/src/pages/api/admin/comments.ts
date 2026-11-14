import { moderateComment, saveCommentBlockedTerms, ServiceError, unblockCommentSource, type CommentModeration } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { boundedFormData, htmlError } from "../../../lib/admin";
import { getEnv } from "../../../lib/env";

const MODERATIONS: readonly string[] = ["hide", "restore", "delete", "block"] satisfies CommentModeration[];

/** Every moderation action on visitor comments; each one is scope-checked and audited in core. */
export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  let back = "/admin/comments";
  try {
    const form = await boundedFormData(request, 64 * 1024);
    // Return to the same filtered page; only the list's own query string is accepted.
    const query = String(form.get("back") ?? "");
    if (/^[\w=&%.+-]{0,300}$/.test(query)) back = `/admin/comments${query ? `?${query}` : ""}`;
    const action = String(form.get("action") ?? "");
    const db = getEnv().DB;
    if (MODERATIONS.includes(action)) {
      const id = Number(form.get("id"));
      if (!Number.isSafeInteger(id) || id <= 0) throw new ServiceError("invalid_request", "没有选择留言", 400);
      await moderateComment(db, id, action as CommentModeration, locals.actor!, requestId);
    } else if (action === "unblock") {
      const source = String(form.get("source") ?? "");
      if (!/^[0-9a-f]{32}$/.test(source)) throw new ServiceError("invalid_request", "来源标识无效", 400);
      await unblockCommentSource(db, source, locals.actor!, requestId);
    } else if (action === "terms") {
      await saveCommentBlockedTerms(db, String(form.get("terms") ?? "").split(/\r?\n/), locals.actor!, requestId);
    } else {
      throw new ServiceError("invalid_request", "未知操作", 400);
    }
    const target = new URL(back, request.url);
    target.searchParams.set("done", action);
    return Response.redirect(target, 303);
  } catch (error) {
    console.error(JSON.stringify({
      message: "admin comment moderation failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return htmlError(error, back);
  }
};
