import {
  DEFAULT_SCORE,
  MAX_SCORE,
  MIN_SCORE,
  SCORE_COUNT,
  SCORES_PER_STAGE,
  STAGES,
  clampScore,
  describeScore,
  formatSignedScore,
} from "./score-domain";

export interface AppController {
  readonly canvas: HTMLCanvasElement;
  readonly slider: HTMLInputElement;
  readonly score: number;
  setScore(score: number): void;
  setLoading(loaded: number, total: number): void;
  setFirstFrameReady(): void;
  setReady(): void;
  setError(message: string): void;
}

export type ScoreChangeHandler = (score: number) => void;

function createTicks(): string {
  return Array.from(
    { length: SCORE_COUNT },
    (_, index) => `<i class="tick" data-score="${MIN_SCORE + index}" aria-hidden="true"></i>`,
  ).join("");
}

function createStageMarkers(): string {
  return STAGES.map(
    (stage, index) =>
      `<li class="stage-marker" data-score="${MIN_SCORE + index * SCORES_PER_STAGE}" style="--marker-index: ${index}">${stage}</li>`,
  ).join("");
}

export function mountApp(
  root: HTMLElement,
  onScoreChange: ScoreChangeHandler = () => undefined,
  initialPoster?: HTMLImageElement,
): AppController {
  const initialState = describeScore(DEFAULT_SCORE);

  root.innerHTML = `
    <div class="experience" data-stage="${initialState.stageIndex}">
      <div class="center-content">
        <header class="masthead">
          <div>
            <p class="eyebrow">YAGINUMA INTENSITY CALIBRATOR</p>
            <h1>滑动变祖器</h1>
          </div>
          <div class="level-meter" aria-live="polite">
            <span>八系强度</span>
            <output class="level-output" for="strength-slider">00</output>
          </div>
        </header>

        <section class="portrait-zone" aria-labelledby="current-stage-label">
          <p class="stage-ghost" aria-hidden="true">${initialState.stage}</p>
          <div class="portrait-shell">
            <div class="imperial-halo" aria-hidden="true"></div>
            <canvas class="portrait-canvas" role="img" aria-label="当前形态：${initialState.stage}"></canvas>
            <div class="scan-grid" aria-hidden="true"></div>
            <span class="frame-corner frame-corner--tl" aria-hidden="true"></span>
            <span class="frame-corner frame-corner--tr" aria-hidden="true"></span>
            <span class="frame-corner frame-corner--bl" aria-hidden="true"></span>
            <span class="frame-corner frame-corner--br" aria-hidden="true"></span>
            <div class="load-state" role="status">载入连续八力…</div>
          </div>

          <div class="stage-readout">
            <span id="current-stage-label">当前状态</span>
            <p class="stage-name" aria-live="polite">${initialState.stage}</p>
            <span class="stage-index">阶段 ${String(initialState.stageIndex + 1).padStart(2, "0")} / 06</span>
          </div>
        </section>

        <section class="control-panel" aria-label="八系强度控制">
          <div class="slider-layout">
            <div class="range-control">
              <div class="range-wrap">
                <div class="tick-track">${createTicks()}</div>
                <input
                  id="strength-slider"
                  class="strength-slider"
                  type="range"
                  min="${MIN_SCORE}"
                  max="${MAX_SCORE}"
                  step="0.01"
                  value="${DEFAULT_SCORE}"
                  aria-label="八系强度"
                  aria-valuetext="${initialState.stage}，强度 00，范围 -15 到 +15"
                  disabled
                />
              </div>
              <ol class="stage-markers">${createStageMarkers()}</ol>
            </div>
          </div>
          <p class="drag-hint"><span aria-hidden="true">←</span> 拖动滑杆，观察形态从 −15 进化至 +15。 <span aria-hidden="true">→</span></p>
        </section>

        <footer class="footer-note">
          <span>31 级连续进化</span>
          <span>正脸识别协议：已启用</span>
        </footer>
      </div>
    </div>
  `;

  if (initialPoster) {
    root.querySelector(".portrait-shell")?.appendChild(initialPoster);
  }

  const experience = root.querySelector<HTMLElement>(".experience")!;
  const canvas = root.querySelector<HTMLCanvasElement>(".portrait-canvas")!;
  const slider = root.querySelector<HTMLInputElement>("#strength-slider")!;
  const output = root.querySelector<HTMLOutputElement>(".level-output")!;
  const stageName = root.querySelector<HTMLElement>(".stage-name")!;
  const stageGhost = root.querySelector<HTMLElement>(".stage-ghost")!;
  const stageIndex = root.querySelector<HTMLElement>(".stage-index")!;
  const loadState = root.querySelector<HTMLElement>(".load-state")!;
  const ticks = Array.from(root.querySelectorAll<HTMLElement>(".tick"));
  const markers = Array.from(root.querySelectorAll<HTMLElement>(".stage-marker"));

  let displayPosition = DEFAULT_SCORE;

  const updateVisuals = (score: number): void => {
    const state = describeScore(score);
    slider.setAttribute(
      "aria-valuetext",
      `${state.stage}，强度 ${formatSignedScore(state.displayScore)}，范围 -15 到 +15`,
    );
    output.textContent = formatSignedScore(state.displayScore);
    stageName.textContent = state.stage;
    stageGhost.textContent = state.stage;
    stageIndex.textContent = `阶段 ${String(state.stageIndex + 1).padStart(2, "0")} / 06`;
    canvas.setAttribute("aria-label", `当前形态：${state.stage}`);
    experience.dataset.stage = String(state.stageIndex);
    experience.style.setProperty("--strength", String(state.trackProgress));
    experience.style.setProperty("--stage-progress", String(state.stageProgress));

    ticks.forEach((tick, index) => {
      tick.classList.toggle("is-active", index <= state.frameIndex);
    });
    markers.forEach((marker, index) => {
      marker.classList.toggle("is-current", index === state.stageIndex);
      marker.classList.toggle("is-passed", index < state.stageIndex);
    });
  };

  const setScore = (rawScore: number): void => {
    displayPosition = clampScore(rawScore);
    slider.value = String(displayPosition);
    updateVisuals(displayPosition);
    onScoreChange(displayPosition);
  };

  slider.addEventListener("input", () => {
    setScore(Number(slider.value));
  });

  setScore(DEFAULT_SCORE);

  return {
    canvas,
    slider,
    get score() {
      return displayPosition;
    },
    setScore,
    setLoading(loaded, total) {
      loadState.textContent = loaded >= total ? "连续八力已就绪" : "载入连续八力…";
    },
    setFirstFrameReady() {
      loadState.hidden = true;
    },
    setReady() {
      slider.disabled = false;
    },
    setError(message) {
      slider.disabled = true;
      loadState.hidden = false;
      loadState.classList.add("is-error");
      loadState.textContent = message;
    },
  };
}
