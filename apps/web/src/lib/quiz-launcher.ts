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

function loadBoard(): Promise<QuizPayload | null> {
  loading ??= fetch("/api/quiz/today", { headers: { accept: "application/json" } })
    .then((response) => (response.ok ? (response.json() as Promise<QuizPayload>) : null))
    .catch(() => null);
  return loading;
}

function renderDots(launcher: HTMLElement, board: QuizPayload): void {
  const dots = launcher.querySelector<HTMLElement>("[data-quiz-dots]");
  const score = launcher.querySelector<HTMLElement>("[data-quiz-launcher-score]");
  if (!dots || !score) return;

  const answered = board.questions.filter((question) => question.answer !== undefined);
  if (board.total > 0 && answered.length === board.total) {
    const hits = answered.filter((question) => question.choice === question.answer).length;
    dots.hidden = true;
    score.hidden = false;
    score.textContent = `${hits}/${board.total}`;
    return;
  }

  score.hidden = true;
  dots.hidden = false;
  dots.replaceChildren(...board.questions.map((question) => {
    const dot = document.createElement("i");
    dot.dataset.done = String(question.answer !== undefined);
    return dot;
  }));
}

export function setupQuizLauncher(): void {
  const launcher = document.querySelector<HTMLElement>("[data-quiz-launcher]");
  const dialog = document.querySelector<HTMLDialogElement>("[data-quiz-dialog]");
  if (!launcher || !dialog) return;

  const board = dialog.querySelector<HTMLElement>("[data-quiz]");
  if (!board) return;

  if (launcher.dataset.quizLauncherReady !== "true") {
    launcher.dataset.quizLauncherReady = "true";

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
      renderDots(launcher, payload);
    });

    dialog.querySelector<HTMLButtonElement>("[data-quiz-close]")?.addEventListener("click", () => dialog.close());

    // A click on the backdrop lands on the dialog itself, never on its content.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });

    // Answers given in the dialog have to show up on the button once it closes.
    dialog.addEventListener("close", () => {
      if (payload) renderDots(launcher, payload);
    });
  }

  const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 1500));
  idle(() => {
    void loadBoard().then((loaded) => {
      if (!loaded || loaded.total === 0) return;
      payload = loaded;
      renderDots(launcher, loaded);
      launcher.hidden = false;
    });
  });
}
