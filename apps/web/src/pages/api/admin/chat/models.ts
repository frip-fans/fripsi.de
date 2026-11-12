import type { APIRoute } from "astro";
import { listChatModels } from "../../../../lib/chat";
import { jsonError } from "../chat";

// A static segment, so it wins over the sibling [id] route.
export const GET: APIRoute = async () => {
  try {
    return Response.json({ models: await listChatModels() });
  } catch (error) { return jsonError(error); }
};
