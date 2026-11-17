import { ContentAdminService } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { boundedFormData, htmlError, readVenueSave } from "../../../../lib/admin";
import { getEnv } from "../../../../lib/env";

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  let back = "/admin/venues";
  try {
    const form = await boundedFormData(request);
    const input = readVenueSave(form);
    if (input.id) back = `/admin/venues/${encodeURIComponent(input.id)}`;
    const venue = await new ContentAdminService(getEnv().DB).saveVenue(input, locals.actor!, requestId);
    return Response.redirect(new URL(`/admin/venues/${venue.id}?saved=1`, request.url), 303);
  } catch (error) {
    console.error(JSON.stringify({
      message: "admin venue save failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return htmlError(error, back);
  }
};
