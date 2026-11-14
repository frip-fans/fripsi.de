import { ServiceError } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { chatModelSettingsView, saveChatModelSettings } from "../../../../lib/chat";
import { jsonError } from "../chat";

/** The whole provider list plus what is stored, for the picker's settings dialog. */
export const GET: APIRoute = async () => {
  try {
    return Response.json(await chatModelSettingsView());
  } catch (error) { return jsonError(error); }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json().catch(() => null) as
      { enabled?: unknown; default_model?: unknown } | null;
    if (!Array.isArray(body?.enabled) || !body.enabled.every((item) => typeof item === "string")) {
      throw new ServiceError("invalid_model", "请求格式无效", 400);
    }
    const chosen = body.default_model;
    if (chosen !== null && chosen !== undefined && typeof chosen !== "string") {
      throw new ServiceError("invalid_model", "请求格式无效", 400);
    }
    await saveChatModelSettings(locals.actor!, body.enabled as string[], chosen ?? null);
    return Response.json(await chatModelSettingsView());
  } catch (error) { return jsonError(error); }
};
