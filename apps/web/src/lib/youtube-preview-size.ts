const sizeKey = "music:youtube:preview-width";
const minWidth = 240;
const maxWidth = 640;
const keyboardStep = 24;

export function setupYouTubePreviewSize(player: HTMLElement) {
  const handle = player.querySelector<HTMLElement>("[data-youtube-size]")!;
  const bounds = () => {
    const max = Math.floor(parseFloat(getComputedStyle(player).maxWidth)) || maxWidth;
    return { min: Math.min(minWidth, max), max };
  };
  const applyWidth = (width: number) => player.style.setProperty("--youtube-preview-width", `${width}px`);
  const rememberWidth = (width: number) => {
    try { localStorage.setItem(sizeKey, String(width)); } catch { /* Storage is optional. */ }
  };

  try {
    const saved = Number(localStorage.getItem(sizeKey));
    if (Number.isFinite(saved) && saved >= minWidth && saved <= maxWidth) applyWidth(saved);
  } catch { /* Storage is optional. */ }

  const syncHandle = () => {
    if (player.hidden || player.hasAttribute("data-inline")) return;
    const { min, max } = bounds();
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute("aria-valuemax", String(max));
    handle.setAttribute("aria-valuenow", String(player.offsetWidth));
  };
  const sizes = new ResizeObserver(syncHandle);
  sizes.observe(player);
  // The viewport limit can change even when the player stays at its current width.
  sizes.observe(document.documentElement);

  let drag: { id: number; x: number; width: number; min: number; max: number } | undefined;
  handle.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, width: player.offsetWidth, ...bounds() };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const width = Math.round(drag.width + drag.x - event.clientX);
    applyWidth(Math.min(drag.max, Math.max(drag.min, width)));
  });
  handle.addEventListener("lostpointercapture", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const width = player.offsetWidth;
    if (width && width !== drag.width) rememberWidth(width);
    drag = undefined;
  });

  handle.addEventListener("keydown", (event) => {
    const { min, max } = bounds();
    const width = player.offsetWidth;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp": next = Math.min(max, width + keyboardStep); break;
      case "ArrowLeft":
      case "ArrowDown": next = Math.max(min, width - keyboardStep); break;
      case "Home": next = min; break;
      case "End": next = max; break;
      default: return;
    }
    event.preventDefault();
    if (next === width) return;
    applyWidth(next);
    rememberWidth(next);
  });

  return () => sizes.disconnect();
}
