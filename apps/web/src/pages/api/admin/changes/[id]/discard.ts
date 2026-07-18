import { ChangeService } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { htmlError } from "../../../../../lib/admin";
import { getEnv } from "../../../../../lib/env";

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    await new ChangeService(getEnv().DB).discard(params.id!, locals.actor!);
    return Response.redirect(new URL("/admin/changes?status=discarded", request.url), 303);
  } catch (error) { return htmlError(error, `/admin/changes/${params.id}`); }
};
