import { ContentAdminService } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { boundedFormData, htmlError, readReleaseSave } from "../../../../../lib/admin";
import { getEnv } from "../../../../../lib/env";

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    const form = await boundedFormData(request);
    const release = await new ContentAdminService(getEnv().DB).saveRelease(readReleaseSave(form), locals.actor!, requestId);
    return Response.redirect(new URL(`/admin/music/releases/${release.id}?saved=1`, request.url), 303);
  } catch (error) {
    console.error(JSON.stringify({
      message: "admin release save failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return htmlError(error, "/admin/music/releases");
  }
};
