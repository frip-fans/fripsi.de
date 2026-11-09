/** One shared background slides between menu items; route semantics stay on links. */
export function setupMenuIndicator(menu: HTMLElement, signal: AbortSignal) {
  const desktop = menu.hasAttribute("data-desktop-menu");
  const region = desktop ? menu : menu.querySelector<HTMLElement>(".mobile-menu-links");
  if (!region) return () => {};
  const indicator = document.createElement("span");
  indicator.className = "menu-active-background";
  indicator.setAttribute("aria-hidden", "true");
  region.insertBefore(indicator, region.firstChild);
  region.classList.add("menu-indicator-ready");
  let selected: HTMLElement | null = null;
  let pending: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let focused: HTMLElement | null = null;
  let animation: Animation | undefined;
  const targetOf = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    const item = target.closest<HTMLElement>("a[href], summary");
    if (!item || !region.contains(item)) return null;
    return desktop ? item.closest(".nav-group")?.querySelector<HTMLElement>("summary") ?? item : item;
  };
  const current = () => targetOf(region.querySelector('[aria-current="page"], .active'));
  const move = (target: HTMLElement | null, animate = true) => {
    if (animate && selected === target && !indicator.hidden) return;
    selected = target;
    if (!target || !target.getClientRects().length) { indicator.hidden = true; return; }
    const from = indicator.getBoundingClientRect();
    const wasVisible = !indicator.hidden && indicator.style.width !== "";
    const box = region.getBoundingClientRect(), to = target.getBoundingClientRect();
    animation?.cancel();
    indicator.hidden = false;
    Object.assign(indicator.style, {
      left: `${to.left - box.left + region.scrollLeft}px`, top: `${to.top - box.top + region.scrollTop}px`,
      width: `${to.width}px`, height: `${to.height}px`, borderRadius: getComputedStyle(target).borderRadius,
    });
    if (animate && wasVisible && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      animation = indicator.animate([
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`, width: `${from.width}px`, height: `${from.height}px` },
        { transform: "translate(0, 0)", width: `${to.width}px`, height: `${to.height}px` },
      ], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  };
  const restore = () => move(pending ?? hovered ?? focused ?? current());
  region.addEventListener("pointerover", event => {
    if (event.pointerType === "touch") return;
    hovered = targetOf(event.target); restore();
  }, { signal });
  region.addEventListener("pointerleave", () => { hovered = null; restore(); }, { signal });
  region.addEventListener("focusin", event => { hovered = null; focused = targetOf(event.target); restore(); }, { signal });
  region.addEventListener("focusout", event => { focused = targetOf(event.relatedTarget); restore(); }, { signal });
  region.addEventListener("click", event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const item = targetOf(event.target);
    if (item?.tagName === "SUMMARY") move(item);
  }, { signal });
  const observer = new MutationObserver(() => {
    pending = targetOf(region.querySelector("[data-menu-loading]"));
    restore();
  });
  observer.observe(region, { subtree: true, attributes: true, attributeFilter: ["data-menu-loading", "open"] });
  const resize = new ResizeObserver(() => move(selected ?? current(), false));
  resize.observe(region);
  const refresh = () => move(selected ?? current(), false);
  window.addEventListener("resize", refresh, { signal });
  document.fonts.ready.then(() => { if (!signal.aborted) refresh(); });
  const reset = () => { pending = hovered = focused = null; move(current(), false); };
  signal.addEventListener("abort", () => { observer.disconnect(); resize.disconnect(); animation?.cancel(); indicator.remove(); region.classList.remove("menu-indicator-ready"); }, { once: true });
  reset();
  return reset;
}
