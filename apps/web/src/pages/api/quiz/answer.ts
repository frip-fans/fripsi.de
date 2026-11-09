import { getOrCreatePuzzle, recordAnswer } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import { playerCookie, puzzleDate, readPlayerId } from "../../../lib/quiz-player";

/** Answers are only accepted from the site's own pages. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!sameOrigin(request)) return Response.json({ error: "bad_origin" }, { status: 403 });

  let body: { questionIndex?: unknown; choice?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const questionIndex = body.questionIndex;
  const choice = body.choice;
  if (!Number.isInteger(questionIndex) || (questionIndex as number) < 0) {
    return Response.json({ error: "invalid_question" }, { status: 400 });
  }
  if (!Number.isInteger(choice) || (choice as number) < 0) {
    return Response.json({ error: "invalid_choice" }, { status: 400 });
  }

  const existing = readPlayerId(request.headers.get("cookie") ?? "");
  const playerId = existing ?? crypto.randomUUID();
  const date = puzzleDate();

  try {
    const db = getEnv().DB;
    const puzzle = await getOrCreatePuzzle(db, date);
    const question = puzzle.questions[questionIndex as number];
    if (!question) return Response.json({ error: "unknown_question" }, { status: 404 });

    const recorded = await recordAnswer(db, date, questionIndex as number, playerId, choice as number);
    if (!recorded) return Response.json({ error: "unknown_question" }, { status: 404 });

    const headers = new Headers({ "cache-control": "no-store" });
    if (!existing) headers.append("set-cookie", playerCookie(playerId, new URL(request.url).protocol === "https:"));

    // The answer index only goes out once the player has committed, so the page cannot
    // be read ahead for the solutions.
    return Response.json({
      correct: recorded.correct,
      choice: recorded.choice,
      answer: question.answer,
      stats: recorded.stats,
      counts: question.type === "more_performed" ? question.counts : undefined,
    }, { headers });
  } catch (error) {
    console.error(JSON.stringify({
      message: "quiz answer failed",
      date,
      questionIndex,
      error: error instanceof Error ? error.message : String(error),
    }));
    return Response.json({ error: "quiz_answer_failed" }, { status: 500 });
  }
};
