import { ChangeService } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { htmlError } from "../../../../../lib/admin";
import { nextReviewLocation } from "../../../../../lib/change-queue";
import { getEnv } from "../../../../../lib/env";

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const db = getEnv().DB;
    await new ChangeService(db).discard(params.id!, locals.actor!);
    return Response.redirect(new URL(await nextReviewLocation(db, params.id!, "discarded"), request.url), 303);
  } catch (error) { return htmlError(error, `/admin/changes/${params.id}`); }
};
