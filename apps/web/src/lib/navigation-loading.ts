export {};

// Loading feedback follows Astro's request lifetime; it never starts a request.
let clearLoading: (() => void) | undefined;

function showLoading(target: URL, signal: AbortSignal, failOpenAfter?: number) {
  clearLoading?.();
  // Explicit non-production diagnostic control; Astro still owns navigation.
  if (document.documentElement?.dataset.navigationFeedback === "off") return;
  const overlay = document.querySelector<HTMLElement>("[data-navigation-loading]");
  const main = document.querySelector<HTMLElement>("main");
  if (!overlay || !main || signal.aborted) return;

  const musicTab = /^\/music\/(lives|songs|releases)\/?$/.test(target.pathname);
  // Keep the tabs available so a second selection can supersede the first request.
  const region = (musicTab && main.querySelector<HTMLElement>("[data-music-browser] .music-list-section")) || main;
  const previousBusy = main.getAttribute("aria-busy");
  const footer = document.querySelector<HTMLElement>("footer");
  const previousFooterInert = footer?.inert;
  const previousInert = region.inert;
  const place = () => {
    const headerBottom = document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0;
    const top = Math.min(Math.max(0, headerBottom, region.getBoundingClientRect().top), innerHeight / 2);
    overlay.style.setProperty("--navigation-loading-top", `${top}px`);
  };
  const lifetime = new AbortController();
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeout);
    overlay.hidden = true;
    region.removeAttribute("data-navigation-obscured");
    region.inert = previousInert;
    if (footer) footer.inert = previousFooterInert ?? false;
    if (previousBusy === null) main.removeAttribute("aria-busy");
    else main.setAttribute("aria-busy", previousBusy);
    lifetime.abort();
    signal.removeEventListener("abort", stop);
    if (clearLoading === stop) clearLoading = undefined;
  };
  clearLoading = stop;
  overlay.dataset.kind = target.pathname === "/calendar" && target.searchParams.get("view") !== "list"
    ? "calendar" : /^\/(music\/(lives|songs|releases)|events)\/[^/]+/.test(target.pathname) ? "detail" : "cards";
  place();
  main.setAttribute("aria-busy", "true");
  region.inert = true;
  if (footer) footer.inert = true;
  region.setAttribute("data-navigation-obscured", "");
  overlay.hidden = false;
  window.addEventListener("resize", place, { signal: lifetime.signal });
  window.addEventListener("scroll", place, { signal: lifetime.signal, passive: true });
  signal.addEventListener("abort", stop, { once: true });

  if (failOpenAfter) timeout = setTimeout(stop, failOpenAfter);
  return stop;
}

document.addEventListener("astro:before-preparation", event => {
  const stop = showLoading(event.to, event.signal);
  if (!stop) return;
  const loader = event.loader;
  event.loader = async () => {
    try {
      await loader();
      // Astro delegates failed/unsupported responses to ordinary navigation.
      if (event.defaultPrevented) stop();
    } catch (error) {
      stop();
      throw error;
    }
  };
  // Another listener may cancel before Astro invokes the loader.
  queueMicrotask(() => { if (event.defaultPrevented) stop(); });
});
// Restore the outgoing DOM before swapping so no loading state is retained.
for (const name of ["astro:before-swap", "astro:page-load", "pageshow", "pagehide"]) {
  (name.startsWith("astro:") ? document : window).addEventListener(name, () => clearLoading?.());
}

// Full-document public destinations (Journey, tools, discussion) get the same
// feedback without changing their native navigation or adding a second router.
document.addEventListener("click", event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLAnchorElement>("a[href]");
  if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self") || link.origin !== location.origin) return;
  if (link.pathname === location.pathname && link.search === location.search) return;
  if (!link.hasAttribute("data-astro-reload") && document.querySelector('meta[name="astro-view-transitions-enabled"]')) return;
  queueMicrotask(() => {
    if (event.defaultPrevented) return;
    // A cancelled native load has no Astro abort event; allow the old page again.
    showLoading(new URL(link.href), new AbortController().signal, 15_000);
  });
});
