import { ChangeService } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { htmlError } from "../../../../../lib/admin";
import { getEnv } from "../../../../../lib/env";

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const form = await request.formData();
    const event = await new ChangeService(getEnv().DB).publish(params.id!, locals.actor!, String(form.get("idempotency_key") ?? ""));
    return Response.redirect(new URL(`/admin/events/${event.id}`, request.url), 303);
  } catch (error) { return htmlError(error, `/admin/changes/${params.id}`); }
};
