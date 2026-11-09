/**
 * Daily quiz interaction: one question at a time, feedback the moment an answer is
 * committed, and a shareable score at the end.
 *
 * The server only sends the correct answer for questions this browser already answered,
 * so the first answer for a question always makes a round trip.
 */

interface QuizStats {
  answered: number;
  correct: number;
}

export interface QuizQuestionView {
  prompt: string;
  options: string[];
  eventHref: string | null;
  songTitles: string[] | null;
  choice?: number;
  answer?: number;
  counts?: number[] | null;
  stats?: QuizStats;
}

/** Shape the answer endpoint returns once a choice is committed. */
interface AnswerResponse {
  correct: boolean;
  choice: number;
  answer: number;
  stats: QuizStats;
  counts?: number[];
}

export interface QuizPayload {
  date: string;
  total: number;
  score: number;
  questions: QuizQuestionView[];
}

type Labels = Record<string, string>;

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

/**
 * Render a board into `root`. Mounting twice on the same element replaces the previous
 * run, so the launcher can reopen with fresh progress without stacking listeners.
 */
export function mountQuiz(root: HTMLElement, payload: QuizPayload, labels: Labels): void {

  const progressNode = root.querySelector<HTMLElement>("[data-quiz-progress]")!;
  const promptNode = root.querySelector<HTMLElement>("[data-quiz-prompt]")!;
  const optionsNode = root.querySelector<HTMLElement>("[data-quiz-options]")!;
  const feedbackNode = root.querySelector<HTMLElement>("[data-quiz-feedback]")!;
  const showLink = root.querySelector<HTMLAnchorElement>("[data-quiz-show-link]")!;
  const staleNext = root.querySelector<HTMLButtonElement>("[data-quiz-next]")!;
  const nextButton = staleNext.cloneNode(true) as HTMLButtonElement;
  staleNext.replaceWith(nextButton);
  const card = root.querySelector<HTMLElement>(".quiz-card")!;
  const finish = root.querySelector<HTMLElement>("[data-quiz-finish]")!;

  // Resume where the player stopped: the first question without a stored answer.
  let index = payload.questions.findIndex((question) => question.answer === undefined);
  if (index === -1) index = payload.questions.length;
  let busy = false;

  nextButton.textContent = labels.next ?? "";

  function results(): boolean[] {
    return payload.questions.map((question) => question.answer !== undefined && question.choice === question.answer);
  }

  /** Clipboard text keeps the familiar emoji grid. */
  function marks(): string {
    return results().map((hit) => (hit ? "\u{1F7E9}" : "\u{1F7E5}")).join("");
  }

  /** On the page the same row is drawn with styled squares, which render everywhere. */
  function renderMarks(node: HTMLElement): void {
    node.replaceChildren(...results().map((hit) => {
      const mark = document.createElement("i");
      mark.dataset.hit = String(hit);
      return mark;
    }));
  }

  function score(): number {
    return payload.questions.filter((question) => question.answer !== undefined && question.choice === question.answer).length;
  }

  /**
   * Esper ranks from the series, Level 0 through Level 5. Five questions map one to one;
   * a thinner puzzle scales so the top answer still reaches Level 5.
   */
  function level(): number {
    return payload.total > 0 ? Math.round((score() / payload.total) * 5) : 0;
  }

  function levelText(): string {
    return fill(labels.levelLabel ?? "", { level: level(), name: labels[`level${level()}`] ?? "" });
  }

  function renderFinish(): void {
    card.hidden = true;
    progressNode.textContent = labels.done ?? "";
    finish.hidden = false;
    finish.querySelector<HTMLElement>("[data-quiz-finish-title]")!.textContent = labels.finishTitle ?? "";
    finish.querySelector<HTMLElement>("[data-quiz-score]")!.textContent = `${score()} / ${payload.total}`;
    finish.querySelector<HTMLElement>("[data-quiz-level]")!.textContent = levelText();
    renderMarks(finish.querySelector<HTMLElement>("[data-quiz-marks]")!);
    finish.querySelector<HTMLElement>("[data-quiz-comeback]")!.textContent = labels.comeBack ?? "";

    const shareButton = finish.querySelector<HTMLButtonElement>("[data-quiz-share]")!;
    shareButton.textContent = labels.share ?? "";
    shareButton.onclick = async () => {
      const text = `${labels.title} ${payload.date}\n${marks()} ${score()}/${payload.total}\n${levelText()}`;
      const url = `${location.origin}/quiz`;

      // The system share sheet is the real thing where it exists; elsewhere, the
      // clipboard carries the same emoji grid people paste into a post.
      if (navigator.share) {
        try {
          await navigator.share({ title: labels.title, text, url });
          return;
        } catch (error) {
          // Dismissing the sheet is a choice, not a failure.
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }

      try {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        shareButton.textContent = labels.shared ?? "";
      } catch {
        shareButton.textContent = labels.failed ?? "";
      }
    };
    shareButton.focus();
  }

  function renderFeedback(question: QuizQuestionView): void {
    const correct = question.choice === question.answer;
    const lines = [correct ? labels.correct : labels.wrong];

    if (question.stats && question.stats.answered > 1) {
      const rate = Math.round((question.stats.correct / question.stats.answered) * 100);
      lines.push(fill(labels.globalRate ?? "", { answered: question.stats.answered, rate }));
    } else if (question.stats) {
      lines.push(labels.firstAnswer ?? "");
    }

    if (question.counts && question.songTitles) {
      lines.push(fill(labels.countsHint ?? "", {
        first: question.songTitles[0],
        firstCount: question.counts[0],
        second: question.songTitles[1],
        secondCount: question.counts[1],
      }));
    }

    feedbackNode.hidden = false;
    feedbackNode.dataset.correct = String(correct);
    feedbackNode.textContent = lines.filter(Boolean).join(" · ");

    if (question.eventHref) {
      showLink.href = question.eventHref;
      showLink.textContent = labels.viewShow ?? "";
      showLink.hidden = false;
    }
    nextButton.hidden = false;
    nextButton.focus();
  }

  async function submit(choice: number): Promise<void> {
    if (busy) return;
    busy = true;
    const question = payload.questions[index];
    optionsNode.querySelectorAll("button").forEach((button) => { button.disabled = true; });

    try {
      const response = await fetch("/api/quiz/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionIndex: index, choice }),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const result = (await response.json()) as AnswerResponse;
      question.choice = result.choice;
      question.answer = result.answer;
      question.counts = result.counts ?? null;
      question.stats = result.stats;
      renderOptionState(question);
      renderFeedback(question);
    } catch {
      feedbackNode.hidden = false;
      feedbackNode.dataset.correct = "false";
      feedbackNode.textContent = labels.failed ?? "";
      optionsNode.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    } finally {
      busy = false;
    }
  }

  function renderOptionState(question: QuizQuestionView): void {
    optionsNode.querySelectorAll<HTMLButtonElement>("button").forEach((button, optionIndex) => {
      button.disabled = true;
      if (question.answer === undefined) return;
      if (optionIndex === question.answer) button.dataset.state = "correct";
      else if (optionIndex === question.choice) button.dataset.state = "wrong";
    });
  }

  function render(): void {
    if (index >= payload.questions.length) {
      renderFinish();
      return;
    }
    const question = payload.questions[index];
    card.hidden = false;
    finish.hidden = true;
    progressNode.textContent = fill(labels.progress ?? "", { current: index + 1, total: payload.total });
    promptNode.textContent = question.prompt;
    feedbackNode.hidden = true;
    feedbackNode.textContent = "";
    showLink.hidden = true;
    nextButton.hidden = true;

    optionsNode.replaceChildren(...question.options.map((label, optionIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => submit(optionIndex));
      return button;
    }));

    if (question.answer !== undefined) {
      renderOptionState(question);
      renderFeedback(question);
    }
  }

  nextButton.addEventListener("click", () => {
    index += 1;
    render();
  });

  render();
}

/** The standalone /quiz page, whose board ships with its payload already embedded. */
export function setupQuizPage(): void {
  const root = document.querySelector<HTMLElement>("[data-quiz]:not([data-quiz-dialog] [data-quiz])");
  if (!root || root.dataset.quizReady === "true") return;

  const payloadNode = root.querySelector<HTMLScriptElement>("[data-quiz-payload]");
  if (!payloadNode?.textContent) return;

  try {
    root.dataset.quizReady = "true";
    mountQuiz(root, JSON.parse(payloadNode.textContent), JSON.parse(root.dataset.labels ?? "{}"));
  } catch {
    /* A malformed payload leaves the board empty rather than breaking the page. */
  }
}
