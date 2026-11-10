import type { APIRoute } from "astro";
import { CHANGE_OPERATION_LABELS, changeHeadline, changedFields } from "../../../../lib/change-review";
import { chatProposals, continueChat, currentChat, endChat, previewProposal, readChat } from "../../../../lib/chat";
import { jsonError, readInput } from "../chat";

/** Cards are capped so one long session cannot turn the poll into a full queue render. */
const MAX_CARDS = 5;

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const actor = locals.actor!;
    const turn = await readChat(actor, params.id!);
    const session = await currentChat(actor);
    const proposals = session ? (await chatProposals(actor, session)).slice(0, MAX_CARDS) : [];
    const canPublish = actor.scopes.includes("events:publish");
    const cards = await Promise.all(proposals.map(async (change) => {
      try {
        const preview = await previewProposal(actor, change.id);
        const headline = changeHeadline(preview.change, preview.before);
        return {
          id: change.id,
          operation: CHANGE_OPERATION_LABELS[change.operation] ?? change.operation,
          title: headline.title,
          date: headline.date,
          source_url: change.source_url,
          warnings: preview.warnings,
          fields: changedFields(preview.before, preview.after).map(({ label, before, after }) => ({ label, before, after })),
          review_path: `/admin/changes/${change.id}`,
          can_publish: canPublish,
        };
      } catch { return null; }
    }));
    return Response.json({ ...turn, proposals: cards.filter(Boolean) });
  } catch (error) { return jsonError(error); }
};

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    await continueChat(locals.actor!, params.id!, await readInput(request));
    return Response.json({ accepted: true });
  } catch (error) { return jsonError(error); }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  try {
    await endChat(locals.actor!, params.id!);
    return Response.json({ closed: true });
  } catch (error) { return jsonError(error); }
};
