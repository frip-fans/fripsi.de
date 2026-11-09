import { mountQuiz, type QuizPayload } from "./quiz-client";

/**
 * Floating entry to the daily quiz.
 *
 * The button sits on every public page and opens one centred dialog; the /quiz page
 * renders the same board inline, so there is a single layout to maintain. Today's board
 * loads once the page is idle rather than on every render, and only the dots need it,
 * so a failed load leaves the button quiet instead of showing an error.
 */

let payload: QuizPayload | null = null;
let loading: Promise<QuizPayload | null> | null = null;

/** Dismissal lasts for the day it was made, so tomorrow's set shows up again. */
const DISMISS_KEY = "frip_fan_quiz_hidden";

function dismissedFor(date: string): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === date;
  } catch {
    return false;
  }
}

function rememberDismissal(date: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, date);
  } catch {
    /* Private windows and blocked storage just lose the preference. */
  }
}

function loadBoard(): Promise<QuizPayload | null> {
  loading ??= fetch("/api/quiz/today", { headers: { accept: "application/json" } })
    .then((response) => (response.ok ? (response.json() as Promise<QuizPayload>) : null))
    .catch(() => null);
  return loading;
}

/** Dots while the set is open; the score and a tick once it is finished. */
function renderDots(bar: HTMLElement, board: QuizPayload): void {
  const dots = bar.querySelector<HTMLElement>("[data-quiz-dots]");
  const score = bar.querySelector<HTMLElement>("[data-quiz-launcher-score]");
  if (!dots || !score) return;

  const answered = board.questions.filter((question) => question.answer !== undefined);
  if (board.total > 0 && answered.length === board.total) {
    const hits = answered.filter((question) => question.choice === question.answer).length;
    bar.dataset.done = "true";
    dots.hidden = true;
    score.hidden = false;
    score.textContent = `${hits}/${board.total}`;
    return;
  }

  delete bar.dataset.done;
  score.hidden = true;
  dots.hidden = false;
  dots.replaceChildren(...board.questions.map((question) => {
    const dot = document.createElement("i");
    dot.dataset.done = String(question.answer !== undefined);
    return dot;
  }));
}

export function setupQuizLauncher(): void {
  const bar = document.querySelector<HTMLElement>("[data-quiz-launcher-bar]");
  const launcher = bar?.querySelector<HTMLElement>("[data-quiz-launcher]");
  const dialog = document.querySelector<HTMLDialogElement>("[data-quiz-dialog]");
  if (!bar || !launcher || !dialog) return;

  const board = dialog.querySelector<HTMLElement>("[data-quiz]");
  if (!board) return;

  if (bar.dataset.quizLauncherReady !== "true") {
    bar.dataset.quizLauncherReady = "true";

    bar.querySelector<HTMLButtonElement>("[data-quiz-dismiss]")?.addEventListener("click", () => {
      bar.hidden = true;
      if (payload) rememberDismissal(payload.date);
    });

    launcher.addEventListener("click", async () => {
      // showModal gives the focus trap, the backdrop and Escape handling for free.
      dialog.showModal();
      const loaded = payload ?? (await loadBoard());
      if (!loaded) {
        dialog.close();
        return;
      }
      payload = loaded;
      mountQuiz(board, payload, JSON.parse(board.dataset.labels ?? "{}"));
      renderDots(bar, payload);
    });

    dialog.querySelector<HTMLButtonElement>("[data-quiz-close]")?.addEventListener("click", () => dialog.close());

    // A click on the backdrop lands on the dialog itself, never on its content.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });

    // Answers given in the dialog have to show up on the button once it closes.
    dialog.addEventListener("close", () => {
      if (payload) renderDots(bar, payload);
    });
  }

  const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 1500));
  idle(() => {
    void loadBoard().then((loaded) => {
      if (!loaded || loaded.total === 0 || dismissedFor(loaded.date)) return;
      payload = loaded;
      renderDots(bar, loaded);
      bar.hidden = false;
    });
  });
}
