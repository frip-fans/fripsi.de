import type { APIRoute } from "astro";
import { chatHistory } from "../../../../lib/chat";
import { jsonError } from "../chat";

export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const before = url.searchParams.get("before") ?? undefined;
    const sessions = await chatHistory(locals.actor!, Number.isFinite(limit) ? limit : 20, before);
    return Response.json({
      sessions: sessions.map((session) => ({
        id: session.id, title: session.title, model: session.model, status: session.status,
        created_at: session.created_at, updated_at: session.updated_at, message_count: session.message_count,
      })),
      next_before: sessions.length ? sessions[sessions.length - 1]!.created_at : null,
    });
  } catch (error) { return jsonError(error); }
};
