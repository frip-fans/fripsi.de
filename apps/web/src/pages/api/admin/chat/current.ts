import type { APIRoute } from "astro";
import { chatDockState } from "../../../../lib/chat";
import { jsonError } from "../chat";

// The same payload SiteLayout renders server-side, so the client has one renderer.
export const GET: APIRoute = async ({ locals }) => {
  try {
    return Response.json(await chatDockState(locals.actor!));
  } catch (error) { return jsonError(error); }
};
