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
    const event = await new ChangeService(getEnv().DB).publishAny(params.id!, locals.actor!, key);
    // A published proposal leads to the record it wrote: the setlist, song, release or tour, not the show's own editor.
    const change = await getChangeSet(getEnv().DB, params.id!);
    const editors: Record<string, string> = { setlist: "/admin/music/setlists", song: "/admin/music/songs", release: "/admin/music/releases", tour: "/admin/tours" };
    const editor = change?.subject_id ? editors[change.subject_type ?? "event"] : undefined;
    const path = editor ? `${editor}/${change!.subject_id}` : event ? `/admin/events/${event.id}` : "/admin/changes";
    if (wantsJson) return Response.json({ event_id: event?.id ?? null, path });
    return Response.redirect(new URL(path, request.url), 303);
  } catch (error) {
    return wantsJson ? jsonError(error) : htmlError(error, `/admin/changes/${params.id}`);
  }
};
