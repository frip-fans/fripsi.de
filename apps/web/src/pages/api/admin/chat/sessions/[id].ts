import type { APIRoute } from "astro";
import { deleteChatMessages } from "@frip-fan/core";
import { chatProposals, chatTranscript, previewProposal } from "../../../../../lib/chat";
import { getEnv } from "../../../../../lib/env";
import { CHANGE_OPERATION_LABELS, changeHeadline, changedFields } from "../../../../../lib/change-review";
import { jsonError } from "../../chat";

const MAX_CARDS = 5;

// No active-session guard and no provider call: an expired transcript stays readable.
export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const actor = locals.actor!;
    const { session, continuable, messages } = await chatTranscript(actor, params.id!);
    const canPublish = actor.scopes.includes("events:publish");
    // Cards are re-derived from change_sets, never from the stored transcript, so a
    // proposal published or discarded since is shown as it is now.
    const proposals = (await chatProposals(actor, session)).slice(0, MAX_CARDS);
    const cards = await Promise.all(proposals.map(async (change) => {
      try {
        const preview = await previewProposal(actor, change.id);
        const headline = changeHeadline(preview.change, preview.before);
        return {
          id: change.id,
          operation: CHANGE_OPERATION_LABELS[change.operation] ?? change.operation,
          title: headline.title, date: headline.date, warnings: preview.warnings,
          fields: changedFields(preview.before, preview.after).map(({ label, before, after }) => ({ label, before, after })),
          review_path: `/admin/changes/${change.id}`, can_publish: canPublish,
        };
      } catch { return null; }
    }));
    return Response.json({
      session: {
        id: session.id, title: session.title, model: session.model, status: session.status,
        created_at: session.created_at, updated_at: session.updated_at, expires_at: session.expires_at,
        message_count: session.message_count, continuable,
      },
      messages: messages.map((message) => ({
        id: message.id, role: message.role, body: message.body, created_at: message.created_at,
        tool_calls: message.tool_calls_json ? JSON.parse(message.tool_calls_json) : [],
      })),
      proposals: cards.filter(Boolean),
    });
  } catch (error) { return jsonError(error); }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  try {
    // chatTranscript scopes by actor, so this cannot delete someone else's record.
    const { session } = await chatTranscript(locals.actor!, params.id!);
    await deleteChatMessages(getEnv().DB, session.id);
    return Response.json({ deleted: true });
  } catch (error) { return jsonError(error); }
};
