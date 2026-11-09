/**
 * Dragging for the floating quiz mascot (desktop; phones use the header button): drag to either
 * side and the position is remembered. A click still opens the quiz; only a press that moves past
 * DRAG_THRESHOLD becomes a drag, and the click that follows it is swallowed.
 */

export interface DockPosition { side: "left" | "right"; bottom: number }

const POSITION_KEY = "frip_fan_quiz_dock";
const DRAG_THRESHOLD = 8;
const EDGE_GAP = 8;

/** Keep the dock fully on screen: between the bottom gap and the top of the viewport. */
export function clampBottom(bottom: number, dockHeight: number, viewportHeight: number): number {
  const max = Math.max(EDGE_GAP, viewportHeight - dockHeight - EDGE_GAP);
  return Math.round(Math.min(Math.max(bottom, EDGE_GAP), max));
}

/** Snap to the side the mascot's centre is on. */
export function snapSide(centreX: number, viewportWidth: number): DockPosition["side"] {
  return centreX < viewportWidth / 2 ? "left" : "right";
}

export function parsePosition(raw: string | null): DockPosition | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DockPosition>;
    if ((value.side === "left" || value.side === "right") && typeof value.bottom === "number" && Number.isFinite(value.bottom)) {
      return { side: value.side, bottom: value.bottom };
    }
  } catch { /* A corrupt value falls back to the default corner. */ }
  return null;
}

function readPosition(): DockPosition | null {
  try { return parsePosition(window.localStorage.getItem(POSITION_KEY)); } catch { return null; }
}

function savePosition(position: DockPosition): void {
  try { window.localStorage.setItem(POSITION_KEY, JSON.stringify(position)); } catch { /* Storage is optional. */ }
}

function applyPosition(dock: HTMLElement, position: DockPosition): void {
  dock.dataset.side = position.side;
  dock.style.setProperty("--quiz-dock-bottom", `${clampBottom(position.bottom, dock.offsetHeight, window.innerHeight)}px`);
}

export function setupQuizDockMotion(dock: HTMLElement): void {
  if (dock.dataset.dockMotion === "true") return;
  dock.dataset.dockMotion = "true";

  const saved = readPosition();
  if (saved) applyPosition(dock, saved);
  window.addEventListener("resize", () => {
    const current = readPosition();
    if (current) applyPosition(dock, current);
  }, { passive: true });

  let start: { x: number; y: number; left: number; top: number; id: number } | null = null;
  let dragged = false;
  let swallowClickUntil = 0;

  const clearInline = () => {
    dock.style.removeProperty("left");
    dock.style.removeProperty("top");
    dock.style.removeProperty("right");
    dock.style.removeProperty("bottom");
  };
  // Transitions stay off until the dropped position has been painted, so nothing slides afterwards.
  const endDrag = () => requestAnimationFrame(() => requestAnimationFrame(() => delete dock.dataset.dragging));

  dock.addEventListener("pointerdown", (event) => {
    const handle = (event.target as Element).closest(".quiz-invite-art, .quiz-invite-open");
    if (!handle || dock.dataset.tucked === "true" || (event.pointerType === "mouse" && event.button !== 0)) return;
    const rect = dock.getBoundingClientRect();
    start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, id: event.pointerId };
    dragged = false;
  });

  dock.addEventListener("pointermove", (event) => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!dragged) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      dragged = true;
      dock.dataset.dragging = "true";
      dock.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    const maxLeft = window.innerWidth - dock.offsetWidth - EDGE_GAP;
    const maxTop = window.innerHeight - dock.offsetHeight - EDGE_GAP;
    dock.style.left = `${Math.min(Math.max(start.left + dx, EDGE_GAP), Math.max(EDGE_GAP, maxLeft))}px`;
    dock.style.top = `${Math.min(Math.max(start.top + dy, EDGE_GAP), Math.max(EDGE_GAP, maxTop))}px`;
    dock.style.right = "auto";
    dock.style.bottom = "auto";
  });

  const finish = (event: PointerEvent) => {
    if (!start || event.pointerId !== start.id) return;
    start = null;
    if (!dragged) return;
    const rect = dock.getBoundingClientRect();
    const position: DockPosition = {
      side: snapSide(rect.left + rect.width / 2, window.innerWidth),
      bottom: clampBottom(window.innerHeight - rect.bottom, rect.height, window.innerHeight),
    };
    clearInline();
    applyPosition(dock, position);
    savePosition(position);
    endDrag();
    // The browser still fires a click after the drag; it must not open the quiz.
    swallowClickUntil = performance.now() + 400;
  };
  dock.addEventListener("pointerup", finish);
  dock.addEventListener("pointercancel", (event) => {
    if (start && event.pointerId === start.id && dragged) {
      clearInline();
      endDrag();
    }
    start = null;
  });
  dock.addEventListener("click", (event) => {
    if (performance.now() < swallowClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { capture: true });
}
