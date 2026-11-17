import { ChangeService, getChangeSet } from "@frip-fan/core";
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
    // A published setlist proposal leads to the setlist it wrote, not to the show's own editor.
    const change = await getChangeSet(getEnv().DB, params.id!);
    const path = change?.subject_type === "setlist" && change.subject_id ? `/admin/music/setlists/${change.subject_id}` : `/admin/events/${event.id}`;
    if (wantsJson) return Response.json({ event_id: event.id, path });
    return Response.redirect(new URL(path, request.url), 303);
  } catch (error) {
    return wantsJson ? jsonError(error) : htmlError(error, `/admin/changes/${params.id}`);
  }
};
