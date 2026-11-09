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
/** Set once the dock is wired, so the greeting can run the moment the board lands. */
let greetOnArrival: (() => void) | null = null;

/** Dismissal lasts for the day it was made, so tomorrow's set shows up again. */
const DISMISS_KEY = "frip_fan_quiz_hidden";
/** The arrival greeting plays once per tab, not on every page within it. */
const GREETED_KEY = "frip_fan_quiz_greeted";
const GREETING_MS = 5200;

function alreadyGreeted(): boolean {
  try {
    return window.sessionStorage.getItem(GREETED_KEY) === "1";
  } catch {
    return true;
  }
}

function markGreeted(): void {
  try {
    window.sessionStorage.setItem(GREETED_KEY, "1");
  } catch {
    /* Without storage the greeting simply plays again next time. */
  }
}

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

/** Nav entries open the same dialog; the /quiz page stays a real, shareable URL. */
const NAV_LINK = '[data-main-nav] a[href="/quiz"], [data-mobile-menu] a[href="/quiz"]';
let navBound = false;

/** A modified click still belongs to the browser: new tab, new window, download. */
function plainClick(event: MouseEvent): boolean {
  return !event.defaultPrevented && event.button === 0
    && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * The mobile menu marks the rest of the page inert while it is open, so the dialog has
 * to wait for the menu to finish closing or it opens behind an inert subtree.
 */
function afterMenuCloses(run: () => void): void {
  const menu = document.querySelector<HTMLElement>("[data-mobile-menu]");
  if (!menu || menu.hidden) {
    run();
    return;
  }
  document.querySelector<HTMLButtonElement>("[data-menu-close]")?.click();
  const deadline = performance.now() + 600;
  const poll = () => {
    if (menu.hidden || performance.now() > deadline) run();
    else requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

export function setupQuizLauncher(): void {
  const bar = document.querySelector<HTMLElement>("[data-quiz-launcher-bar]");
  const launcher = bar?.querySelector<HTMLElement>("[data-quiz-launcher]");
  const dialog = document.querySelector<HTMLDialogElement>("[data-quiz-dialog]");
  if (!bar || !launcher || !dialog) return;

  const board = dialog.querySelector<HTMLElement>("[data-quiz]");
  if (!board) return;

  // An arrow const keeps the null checks above narrowed; a hoisted declaration would not.
  const openDialog = async (): Promise<void> => {
    // showModal gives the focus trap, the backdrop and Escape handling for free.
    dialog.showModal();
    const loaded = payload ?? (await loadBoard());
    if (!loaded || loaded.total === 0) {
      dialog.close();
      return;
    }
    payload = loaded;
    mountQuiz(board, payload, JSON.parse(board.dataset.labels ?? "{}"));
    renderDots(bar, payload);
  };

  const restore = bar.querySelector<HTMLButtonElement>("[data-quiz-restore]");
  const dismiss = bar.querySelector<HTMLButtonElement>("[data-quiz-dismiss]");
  const setTucked = (tucked: boolean) => {
    bar.dataset.tucked = String(tucked);
    launcher.hidden = tucked;
    if (dismiss) dismiss.hidden = tucked;
    if (restore) restore.hidden = !tucked;
  };

  if (bar.dataset.quizLauncherReady !== "true") {
    bar.dataset.quizLauncherReady = "true";

    greetOnArrival = () => {
      if (alreadyGreeted() || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      markGreeted();
      bar.dataset.fresh = "true";
      window.setTimeout(() => {
        delete bar.dataset.fresh;
      }, GREETING_MS);
    };

    let greetingTimer: number | undefined;
    dismiss?.addEventListener("click", () => {
      window.clearTimeout(greetingTimer);
      delete bar.dataset.greeting;
      setTucked(true);
      restore?.focus({ preventScroll: true });
      if (payload) rememberDismissal(payload.date);
    });

    restore?.addEventListener("click", () => {
      setTucked(false);
      try { window.localStorage.removeItem(DISMISS_KEY); } catch { /* Storage is optional. */ }
      bar.dataset.greeting = "true";
      window.clearTimeout(greetingTimer);
      greetingTimer = window.setTimeout(() => delete bar.dataset.greeting, 1800);
      launcher.focus({ preventScroll: true });
    });

    launcher.addEventListener("click", () => void openDialog());

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

  if (!navBound) {
    navBound = true;
    // Capture phase: the view-transition router also claims link clicks on document,
    // and it would navigate before a bubbling listener ever saw the event.
    document.addEventListener("click", (event) => {
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(NAV_LINK);
      if (!link || !plainClick(event)) return;
      // Without a dialog on this page the link navigates to /quiz as usual.
      if (!document.querySelector("[data-quiz-dialog]")) return;
      event.preventDefault();
      event.stopPropagation();
      afterMenuCloses(() => void openDialog());
    }, { capture: true });
  }

  const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 1500));
  idle(() => {
    void loadBoard().then((loaded) => {
      if (!loaded || loaded.total === 0) return;
      payload = loaded;
      renderDots(bar, loaded);
      setTucked(dismissedFor(loaded.date));
      bar.hidden = false;
      greetOnArrival?.();
    });
  });
}
