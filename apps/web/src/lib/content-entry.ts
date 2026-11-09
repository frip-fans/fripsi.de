const active = new Map<HTMLElement, Animation>();
let motion: MediaQueryList | undefined;

export function cancelContentEntry(element: HTMLElement | null) {
  if (!element) return;
  const animation = active.get(element);
  active.delete(element);
  animation?.cancel();
}

export function cancelContentEntries() {
  const animations = [...active.values()];
  active.clear();
  animations.forEach(animation => animation.cancel());
}

// Only incoming content is animated, with no geometry reads, inline resting
// styles, hidden/inert changes, or promises that navigation has to await.
export function playContentEntry(element: HTMLElement | null): void {
  cancelContentEntry(element);
  if (!element?.isConnected || element.hidden || typeof element.animate !== "function" || typeof window === "undefined" || document.hidden) return;
  if (!motion) {
    motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    motion.addEventListener("change", () => { if (motion?.matches) cancelContentEntries(); });
  }
  if (motion.matches) return;
  // Bound compositing work even when independent regions update together.
  if (active.size >= 2) cancelContentEntry(active.keys().next().value ?? null);
  try {
    const animation = element.animate([
      { opacity: .35, transform: "translateY(3px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: 240, easing: "ease-out", fill: "none" });
    animation.id = "frip-content-entry";
    active.set(element, animation);
    const forget = () => { if (active.get(element) === animation) active.delete(element); };
    animation.addEventListener("cancel", forget, { once: true });
    animation.addEventListener("finish", () => { forget(); animation.cancel(); }, { once: true });
  } catch { /* Unsupported animation must leave the new content usable. */ }
}

export function playResultsEntry(element: HTMLElement | null): void {
  if (!element) return;
  const items = element.querySelector("[data-music-items], [data-event-items]");
  // Avoid animating a tall accumulated list or a restored reading position.
  if (Number(element.dataset.page ?? 1) > 1 || (items?.children.length ?? 0) > 12) return;
  playContentEntry(element);
}
