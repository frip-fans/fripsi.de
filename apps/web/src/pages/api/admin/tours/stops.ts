import { ContentAdminService } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { boundedFormData, htmlError, readTourStopsUpdate } from "../../../../lib/admin";
import { getEnv } from "../../../../lib/env";

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  let back = "/admin/tours";
  try {
    const form = await boundedFormData(request);
    const input = readTourStopsUpdate(form);
    if (/^[\w-]+$/.test(input.tour_id)) back = `/admin/tours/${input.tour_id}`;
    const result = await new ContentAdminService(getEnv().DB).updateTourStops(input, locals.actor!, requestId);
    const target = new URL(`/admin/tours/${result.tour.id}`, request.url);
    target.searchParams.set("added", String(result.added));
    target.searchParams.set("removed", String(result.removed));
    return Response.redirect(target, 303);
  } catch (error) {
    console.error(JSON.stringify({
      message: "admin tour stops update failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return htmlError(error, back);
  }
};
