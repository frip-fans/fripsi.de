import { ChangeService } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { htmlError } from "../../../../../lib/admin";
import { getEnv } from "../../../../../lib/env";
import { jsonError } from "../../chat";

export const POST: APIRoute = async ({ request, locals, params }) => {
  // The admin review page posts a form and follows a redirect; the chat proposal card
  // posts JSON and stays on the page.
  const wantsJson = request.headers.get("content-type")?.includes("application/json") ?? false;
  try {
    const key = wantsJson
      ? String(((await request.json().catch(() => ({}))) as { idempotency_key?: unknown }).idempotency_key ?? "")
      : String((await request.formData()).get("idempotency_key") ?? "");
    const event = await new ChangeService(getEnv().DB).publish(params.id!, locals.actor!, key);
    if (wantsJson) return Response.json({ event_id: event.id, path: `/admin/events/${event.id}` });
    return Response.redirect(new URL(`/admin/events/${event.id}`, request.url), 303);
  } catch (error) {
    return wantsJson ? jsonError(error) : htmlError(error, `/admin/changes/${params.id}`);
  }
};
