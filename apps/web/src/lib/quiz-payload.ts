import { getOrCreatePuzzle, getPlayerProgress, getPuzzleStats, type QuizQuestion } from "@frip-fan/core";
import { t, type Locale } from "./i18n";
import { puzzleDate, readPlayerId } from "./quiz-player";

/**
 * One question as the browser sees it. The correct answer is attached only once this
 * browser has committed to a choice, so neither the page nor the launcher can be read
 * ahead for today's solutions.
 */
export interface QuizQuestionPayload {
  prompt: string;
  options: string[];
  eventHref: string | null;
  songTitles: string[] | null;
  choice?: number;
  answer?: number;
  counts?: number[] | null;
  stats?: { answered: number; correct: number };
}

export interface QuizPayload {
  date: string;
  total: number;
  score: number;
  questions: QuizQuestionPayload[];
}

function prompt(locale: Locale, question: QuizQuestion): string {
  if (question.type === "more_performed") return t(locale, "quiz.questionMorePerformed");
  const values = { date: question.event.date, event: question.event.title };
  return question.type === "performed"
    ? t(locale, "quiz.questionPerformed", { ...values, song: question.song.title })
    : t(locale, "quiz.questionEncore", values);
}

function options(locale: Locale, question: QuizQuestion): string[] {
  return question.type === "performed"
    ? [t(locale, "quiz.yes"), t(locale, "quiz.no")]
    : question.options.map((option) => option.title);
}

/** Everything the quiz board needs to render, for the page and the launcher alike. */
export async function buildQuizPayload(db: D1Database, locale: Locale, cookieHeader: string): Promise<QuizPayload> {
  const date = puzzleDate();
  const puzzle = await getOrCreatePuzzle(db, date);
  const total = puzzle.questions.length;

  const playerId = readPlayerId(cookieHeader);
  const progress = playerId
    ? await getPlayerProgress(db, date, playerId, total)
    : { choices: Array.from({ length: total }, () => null), score: 0, answered: 0 };
  const stats = await getPuzzleStats(db, date);

  return {
    date,
    total,
    score: progress.score,
    questions: puzzle.questions.map((question, index) => {
      const choice = progress.choices[index];
      const base: QuizQuestionPayload = {
        prompt: prompt(locale, question),
        options: options(locale, question),
        eventHref: question.type === "more_performed" ? null : `/events/${encodeURIComponent(question.event.slug)}`,
        songTitles: question.type === "more_performed" ? question.options.map((option) => option.title) : null,
      };
      if (choice === null) return base;
      return {
        ...base,
        choice,
        answer: question.answer,
        counts: question.type === "more_performed" ? question.counts : null,
        stats: stats.get(index) ?? { answered: 0, correct: 0 },
      };
    }),
  };
}

/** Wording the client needs; kept in one place so the page and launcher never drift. */
export function quizLabels(locale: Locale): Record<string, string> {
  return {
    progress: t(locale, "quiz.progress"),
    correct: t(locale, "quiz.correct"),
    wrong: t(locale, "quiz.wrong"),
    globalRate: t(locale, "quiz.globalRate"),
    firstAnswer: t(locale, "quiz.firstAnswer"),
    countsHint: t(locale, "quiz.countsHint"),
    next: t(locale, "quiz.next"),
    finishTitle: t(locale, "quiz.finishTitle"),
    share: t(locale, "quiz.share"),
    shared: t(locale, "quiz.shared"),
    cardScan: t(locale, "quiz.cardScan"),
    saveImage: t(locale, "quiz.saveImage"),
    sendImage: t(locale, "quiz.sendImage"),
    copyText: t(locale, "quiz.copyText"),
    cardHint: t(locale, "quiz.cardHint"),
    comeBack: t(locale, "quiz.comeBack"),
    viewShow: t(locale, "quiz.viewShow"),
    done: t(locale, "quiz.done"),
    failed: t(locale, "quiz.failed"),
    title: t(locale, "quiz.title"),
    empty: t(locale, "quiz.empty"),
    levelLabel: t(locale, "quiz.levelLabel"),
    level0: t(locale, "quiz.level0"),
    level1: t(locale, "quiz.level1"),
    level2: t(locale, "quiz.level2"),
    level3: t(locale, "quiz.level3"),
    level4: t(locale, "quiz.level4"),
    level5: t(locale, "quiz.level5"),
  };
}
