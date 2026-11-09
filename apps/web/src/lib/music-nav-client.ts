interface TabCopy { href: string; label: string }
let mounted: HTMLElement | null = null;
let cleanup: (() => void) | undefined;
let incoming: TabCopy[] | undefined;

function musicTabsNeedCompact(available: number, natural: number[], gap: number): boolean {
  return natural.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, natural.length - 1) > available + .5;
}

function setupMusicNav() {
  const tabs = document.querySelector<HTMLElement>("[data-music-tabs]");
  const persisted = tabs === mounted;
  if (tabs !== mounted) { cleanup?.(); cleanup = undefined; mounted = tabs; }
  if (!tabs) { incoming = undefined; return; }
  const links = [...tabs.querySelectorAll<HTMLAnchorElement>("a")];
  if (incoming) links.forEach((link, index) => {
    const copy = incoming?.[index];
    if (!copy) return;
    link.href = copy.href;
    link.querySelector("span")!.textContent = copy.label;
    link.setAttribute("aria-label", copy.label);
  });
  incoming = undefined;
  // Reinserted persisted nodes need their old layout established before changing
  // selection, otherwise browsers jump straight to the new flex widths.
  if (persisted) void tabs.offsetWidth;
  links.forEach(link => {
    const active = new URL(link.href).pathname === location.pathname;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const active = links.find(link => link.classList.contains("active"));
  if (!active) return;
  document.querySelectorAll<HTMLAnchorElement>("[data-music-entry]").forEach(entry => { entry.href = active.href; });
  try { localStorage.setItem("music:last-view", new URL(active.href).pathname); } catch { /* storage can be unavailable */ }

  const layout = () => {
    if (!tabs.isConnected) return;
    const style = getComputedStyle(tabs);
    const padding = parseFloat(style.paddingLeft);
    const gap = parseFloat(style.columnGap);
    const linkStyle = getComputedStyle(active);
    const fullGap = parseFloat(linkStyle.columnGap);
    const natural = links.map(link => {
      // Measure an unconstrained copy: a shrinking/ellipsized label's scrollWidth
      // can reflect its current animation rather than its full text width.
      const measure = link.querySelector("span")!.cloneNode(true) as HTMLElement;
      measure.style.cssText = "position:fixed;visibility:hidden;width:max-content;max-width:none;white-space:nowrap;transition:none";
      link.append(measure);
      const textWidth = measure.getBoundingClientRect().width;
      measure.remove();
      return textWidth + link.querySelector(".icon")!.getBoundingClientRect().width
        + parseFloat(linkStyle.paddingLeft) + parseFloat(linkStyle.paddingRight) + fullGap;
    });
    const available = tabs.clientWidth - padding - parseFloat(style.paddingRight);
    const compact = matchMedia("(max-width: 560px)").matches && musicTabsNeedCompact(available, natural, gap);
    const modeChanged = tabs.hasAttribute("data-compact") !== compact;
    if (modeChanged) tabs.dataset.resizing = "true";
    tabs.toggleAttribute("data-compact", compact);
    // In compact mode the selected tab takes all space left by two 48px icons.
    // Compute its final geometry so the highlight and flex widths animate together.
    const index = links.indexOf(active);
    const x = compact ? padding + index * (48 + gap) : active.offsetLeft;
    const width = compact ? available - (links.length - 1) * (48 + gap) : active.offsetWidth;
    tabs.style.setProperty("--tab-x", `${x}px`);
    tabs.style.setProperty("--tab-y", `${active.offsetTop}px`);
    tabs.style.setProperty("--tab-width", `${width}px`);
    tabs.style.setProperty("--tab-height", `${active.offsetHeight}px`);
    tabs.dataset.ready = "true";
    if (modeChanged) {
      void tabs.offsetWidth;
      requestAnimationFrame(() => { delete tabs.dataset.resizing; });
    }
  };
  layout();
  // Each completed route changes which element supplies the current label/geometry.
  cleanup?.();
  const observer = new ResizeObserver(layout);
  observer.observe(tabs);
  const controller = new AbortController();
  window.addEventListener("resize", layout, { signal: controller.signal });
  document.fonts.ready.then(() => { if (!controller.signal.aborted) layout(); });
  cleanup = () => { observer.disconnect(); controller.abort(); };
}

// Persist only this small navigation bar, preserving its live CSS transitions.
// Copy translated labels from the incoming HTML so locale switches stay correct.
document.addEventListener("astro:before-swap", event => {
  const next = event.newDocument.querySelector<HTMLElement>("[data-music-tabs]");
  incoming = next ? [...next.querySelectorAll<HTMLAnchorElement>("a")].map(link => ({
    href: link.href, label: link.querySelector("span")!.textContent ?? "",
  })) : undefined;
  if (next && mounted) mounted.setAttribute("aria-label", next.getAttribute("aria-label") ?? "");
});
document.addEventListener("astro:after-swap", setupMusicNav);
document.addEventListener("astro:page-load", setupMusicNav);
setupMusicNav();
