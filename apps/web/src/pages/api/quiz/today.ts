import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import { getLocale } from "../../../lib/i18n";
import { buildQuizPayload } from "../../../lib/quiz-payload";

/** Today's board for the floating launcher, which loads it after the page settles. */
export const GET: APIRoute = async ({ request }) => {
  try {
    const payload = await buildQuizPayload(getEnv().DB, getLocale(request), request.headers.get("cookie") ?? "");
    // Progress is per browser, so this must never be cached by a shared layer.
    return Response.json(payload, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error(JSON.stringify({
      message: "quiz board query failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return Response.json({ error: "quiz_board_failed" }, { status: 500 });
  }
};
