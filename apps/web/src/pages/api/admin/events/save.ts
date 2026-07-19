import { ContentAdminService } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { boundedFormData, htmlError, readDirectEventSave } from "../../../../lib/admin";
import { getEnv } from "../../../../lib/env";

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    const form = await boundedFormData(request);
    const service = new ContentAdminService(getEnv().DB);
    const intent = String(form.get("intent") ?? "save");
    const event = intent === "archive"
      ? await service.setEventArchived({
          id: String(form.get("id") ?? ""),
          expected_version: Number(form.get("expected_version")),
          archived: String(form.get("archived") ?? "") === "1",
          idempotency_key: String(form.get("idempotency_key") ?? ""),
        }, locals.actor!, requestId)
      : await service.saveEvent(readDirectEventSave(form), locals.actor!, requestId);
    return Response.redirect(new URL(`/admin/events/${event.id}?saved=1`, request.url), 303);
  } catch (error) {
    console.error(JSON.stringify({
      message: "admin event save failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return htmlError(error, "/admin/events");
  }
};
