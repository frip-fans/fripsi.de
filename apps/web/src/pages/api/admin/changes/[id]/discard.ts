import { ChangeService } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { htmlError } from "../../../../../lib/admin";
import { nextReviewLocation } from "../../../../../lib/change-queue";
import { getEnv } from "../../../../../lib/env";
import { jsonError } from "../../chat";

export const POST: APIRoute = async ({ request, locals, params }) => {
  const wantsJson = request.headers.get("content-type")?.includes("application/json") ?? false;
  try {
    const db = getEnv().DB;
    await new ChangeService(db).discard(params.id!, locals.actor!);
    if (wantsJson) return Response.json({ discarded: true });
    return Response.redirect(new URL(await nextReviewLocation(db, params.id!, "discarded"), request.url), 303);
  } catch (error) {
    return wantsJson ? jsonError(error) : htmlError(error, `/admin/changes/${params.id}`);
  }
};
