import type { APIRoute } from "astro";
import { chatModelChoices } from "../../../../lib/chat";
import { jsonError } from "../chat";

// A static segment, so it wins over the sibling [id] route. Only the models the
// operator ticked in /admin/settings are offered; the full provider list lives there.
export const GET: APIRoute = async () => {
  try {
    return Response.json(await chatModelChoices());
  } catch (error) { return jsonError(error); }
};
