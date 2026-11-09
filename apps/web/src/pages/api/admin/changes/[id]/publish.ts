import { ChangeService } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { htmlError } from "../../../../../lib/admin";
import { nextReviewLocation } from "../../../../../lib/change-queue";
import { getEnv } from "../../../../../lib/env";

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const form = await request.formData();
    const reviewed = Number(form.get("reviewed_version"));
    const db = getEnv().DB;
    const event = await new ChangeService(db).publish(params.id!, locals.actor!, String(form.get("idempotency_key") ?? ""), undefined,
      Number.isInteger(reviewed) && reviewed > 0 ? { reviewedVersion: reviewed } : {});
    return Response.redirect(new URL(await nextReviewLocation(db, params.id!, "published", event.id), request.url), 303);
  } catch (error) { return htmlError(error, `/admin/changes/${params.id}`); }
};
