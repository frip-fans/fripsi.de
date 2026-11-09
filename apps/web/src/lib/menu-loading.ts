/** Immediate feedback on the chosen menu item; Astro still owns navigation. */
export function setupMenuLoading(menu: HTMLElement, signal: AbortSignal) {
  const status = menu.querySelector<HTMLElement>("[data-menu-loading-status]");
  let active: { stop: () => void } | undefined;
  const clear = () => active?.stop();
  const isNewPage = (link: HTMLAnchorElement) => link.origin === location.origin
    && (link.pathname !== location.pathname || link.search !== location.search);
  const begin = (link: HTMLAnchorElement, requestSignal?: AbortSignal) => {
    clear();
    if (menu.hidden || signal.aborted || requestSignal?.aborted) return;
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timeout);
      link.removeAttribute("data-menu-loading");
      link.removeAttribute("aria-busy");
      if (status) status.textContent = "";
      requestSignal?.removeEventListener("abort", stop);
      if (active?.stop === stop) active = undefined;
    };
    active = { stop };
    link.setAttribute("data-menu-loading", "");
    link.setAttribute("aria-busy", "true");
    if (status) status.textContent = menu.dataset.loadingLabel ?? "";
    requestSignal?.addEventListener("abort", stop, { once: true });
    // Native navigation has no router abort signal (e.g. the browser's Stop).
    if (!requestSignal) timeout = setTimeout(stop, 15_000);
    return stop;
  };

  document.addEventListener("astro:before-preparation", event => {
    const link = event.sourceElement?.closest<HTMLAnchorElement>("a[href]");
    if (!link || !menu.contains(link) || !isNewPage(link)) return;
    const stop = begin(link, event.signal);
    if (!stop) return;
    const loader = event.loader;
    event.loader = async () => {
      try {
        await loader();
        if (event.defaultPrevented) stop();
      } catch (error) {
        stop();
        throw error;
      }
    };
    queueMicrotask(() => { if (event.defaultPrevented) stop(); });
  }, { signal });

  menu.addEventListener("click", event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!link || !menu.contains(link) || link.hasAttribute("download") || (link.target && link.target !== "_self") || !isNewPage(link)) return;
    // ClientRouter prevents the click and supplies its own request signal above.
    queueMicrotask(() => { if (!event.defaultPrevented) begin(link); });
  }, { signal });
  for (const event of ["astro:after-swap", "astro:page-load"]) document.addEventListener(event, clear, { signal });
  for (const event of ["pagehide", "pageshow"]) window.addEventListener(event, clear, { signal });
  signal.addEventListener("abort", clear, { once: true });
  return clear;
}
