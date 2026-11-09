import { NAVIGATION_FEEDBACK_DELAY_MS } from "./navigation-feedback";

// Loading feedback follows Astro's request lifetime; it never starts a request.
let clearLoading: (() => void) | undefined;

function showLoading(signal: AbortSignal, failOpenAfter?: number) {
  clearLoading?.();
  // Explicit non-production diagnostic control; Astro still owns navigation.
  if (document.documentElement?.dataset.navigationFeedback === "off") return;
  const indicator = document.querySelector<HTMLElement>("[data-navigation-loading]");
  if (!indicator || signal.aborted) return;

  // Keep the outgoing DOM visible and interactive. Full-page loading feedback
  // stalled Safari in device A/B testing even with static placeholders. Avoid
  // its outgoing-page state changes and layout work here.
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeout);
    clearTimeout(showTimer);
    indicator.hidden = true;
    signal.removeEventListener("abort", stop);
    if (clearLoading === stop) clearLoading = undefined;
  };
  clearLoading = stop;
  showTimer = setTimeout(() => {
    if (!stopped && !signal.aborted) indicator.hidden = false;
  }, NAVIGATION_FEEDBACK_DELAY_MS);
  signal.addEventListener("abort", stop, { once: true });
  if (failOpenAfter) timeout = setTimeout(stop, failOpenAfter);
  return stop;
}

document.addEventListener("astro:before-preparation", event => {
  const stop = showLoading(event.signal);
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

// Full-document public destinations (Journey and tools) get the same
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
    showLoading(new AbortController().signal, 15_000);
  });
});
