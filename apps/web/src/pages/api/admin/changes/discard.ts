import { ChangeService, ServiceError } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { boundedFormData, htmlError } from "../../../../lib/admin";
import { getEnv } from "../../../../lib/env";

/** Discards the selected pending proposals; each one is still checked and audited individually. */
export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    const form = await boundedFormData(request, 64 * 1024);
    const ids = [...new Set(form.getAll("id").map(String).filter(Boolean))];
    if (!ids.length) throw new ServiceError("invalid_request", "没有选择提案", 400);
    if (ids.length > 200) throw new ServiceError("invalid_request", "一次最多丢弃 200 条提案", 400);
    const service = new ChangeService(getEnv().DB);
    let discarded = 0;
    for (const id of ids) {
      await service.discard(id, locals.actor!, requestId);
      discarded += 1;
    }
    return Response.redirect(new URL(`/admin/changes?discarded=${discarded}`, request.url), 303);
  } catch (error) {
    return htmlError(error, "/admin/changes");
  }
};
