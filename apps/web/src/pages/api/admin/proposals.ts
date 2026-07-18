import { ChangeService } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { htmlError, readEventForm, readEventPatch } from "../../../lib/admin";
import { getEnv } from "../../../lib/env";

export const POST: APIRoute = async ({ request, locals }) => {
  const form = await request.formData();
  const service = new ChangeService(getEnv().DB);
  const actor = locals.actor!;
  const intent = String(form.get("intent") ?? "");
  try {
    let change;
    if (intent === "create") {
      const event = readEventForm(form);
      change = await service.proposeCreate({
        event,
        source_url: event.sources[0]?.url,
        reason: String(form.get("reason") ?? ""),
        idempotency_key: String(form.get("idempotency_key") ?? "")
      }, actor);
    } else if (intent === "update") {
      const patch = readEventPatch(form);
      change = await service.proposeUpdate({
        target_event_id: String(form.get("target_event_id") ?? ""),
        expected_version: Number(form.get("expected_version")),
        patch,
        source_url: patch.sources?.[0]?.url,
        reason: String(form.get("reason") ?? ""),
        idempotency_key: String(form.get("idempotency_key") ?? "")
      }, actor);
    } else if (intent === "status") {
      change = await service.proposeStatus({
        target_event_id: String(form.get("target_event_id") ?? ""),
        expected_version: Number(form.get("expected_version")),
        status: String(form.get("status") ?? ""),
        source_url: String(form.get("source_url") ?? ""),
        reason: String(form.get("reason") ?? ""),
        idempotency_key: String(form.get("idempotency_key") ?? "")
      }, actor);
    } else if (["unpublish", "archive", "restore"].includes(intent)) {
      change = await service.proposeLifecycle(intent as "unpublish" | "archive" | "restore", {
        target_event_id: String(form.get("target_event_id") ?? ""),
        expected_version: Number(form.get("expected_version")),
        reason: String(form.get("reason") ?? ""),
        idempotency_key: String(form.get("idempotency_key") ?? "")
      }, actor);
    } else throw new Error("未知操作");
    return Response.redirect(new URL(`/admin/changes/${change.id}`, request.url), 303);
  } catch (error) {
    const referer = request.headers.get("referer");
    let back = "/admin/events";
    if (referer) {
      try { back = new URL(referer).pathname; } catch { /* use safe fallback */ }
    }
    return htmlError(error, back);
  }
};
