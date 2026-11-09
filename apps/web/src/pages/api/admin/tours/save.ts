import { ContentAdminService } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { boundedFormData, htmlError, readTourSave } from "../../../../lib/admin";
import { getEnv } from "../../../../lib/env";

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    const form = await boundedFormData(request);
    const tour = await new ContentAdminService(getEnv().DB).saveTour(readTourSave(form), locals.actor!, requestId);
    return Response.redirect(new URL(`/admin/tours/${tour.id}?saved=1`, request.url), 303);
  } catch (error) {
    console.error(JSON.stringify({
      message: "admin tour save failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return htmlError(error, "/admin/tours");
  }
};
