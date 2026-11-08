import { setupReleaseCovers } from "../scripts/release-cover";

let mounted: HTMLElement | null = null;
let dispose: (() => void) | undefined;

export function setupMusicBrowser() {
  const root = document.querySelector<HTMLElement>("[data-music-browser]");
  if (root === mounted) return;
  dispose?.();
  mounted = root;
  if (!root) return;
  root.dataset.ready = "true";
  root.dataset.musicUrl = location.href;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  try {
    localStorage.setItem("music:last-view", location.pathname);
    sessionStorage.setItem(`music:list:${root.dataset.kind}`, `${location.pathname}${location.search}`);
  } catch { /* storage can be unavailable */ }
  document.querySelectorAll<HTMLAnchorElement>("[data-music-entry]").forEach(entry => { entry.href = location.href; });
  const tabs = root.querySelector<HTMLElement>("[data-music-tabs]");
  const activeTab = tabs?.querySelector<HTMLElement>("a.active");
  if (tabs && activeTab && tabs.scrollWidth > tabs.clientWidth) tabs.scrollTo({ left: activeTab.offsetLeft - (tabs.clientWidth - activeTab.offsetWidth) / 2, behavior: "instant" });
  const form = root.querySelector<HTMLFormElement>("[data-music-form]")!;
  const input = root.querySelector<HTMLInputElement>("[data-music-search]")!;
  const error = root.querySelector<HTMLElement>("[data-music-error]")!;
  const status = root.querySelector<HTMLElement>("[data-music-status]")!;
  status.textContent = "";
  const results = () => root.querySelector<HTMLElement>("[data-music-results]")!;
  const more = () => root.querySelector<HTMLAnchorElement>("[data-music-more]")!;
  let request: AbortController | undefined;
  let serial = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  let retryMore = false;
  let openKind = "";

  const params = () => {
    const next = new URLSearchParams();
    if (root.dataset.kind === "releases" && matchMedia("(min-width: 1200px)").matches) next.set("batch", "8");
    for (const [key, value] of new FormData(form)) {
      if (typeof value === "string" && value.trim()) next.set(key, value.trim());
    }
    return next;
  };
  const syncControls = () => {
    const filterLabels: string[] = [];
    let count = 0;
    for (const select of form.querySelectorAll("[data-music-filter]")) {
      if (!(select instanceof HTMLSelectElement)) continue;
      count += Number(Boolean(select.value));
      const option = select.selectedOptions[0];
      if (option) filterLabels.push(option.dataset.summary ?? option.textContent ?? "");
    }
    const badge = root.querySelector<HTMLElement>("[data-music-filter-count]");
    if (badge) { badge.textContent = String(count); badge.hidden = count === 0; }
    root.querySelector<HTMLElement>('[data-music-toggle="filter"]')?.classList.toggle("active", count > 0);
    const clear = root.querySelector<HTMLButtonElement>("[data-music-clear]");
    if (clear) clear.disabled = count === 0;
    const sort = form.querySelector<HTMLInputElement>('input[name="sort"]:checked');
    const label = sort?.dataset.sortLabel ?? "";
    root.querySelector<HTMLElement>("[data-music-sort-label]")!.textContent = label;
    root.querySelector<HTMLElement>("[data-music-scope]")!.textContent = [...filterLabels, label].filter(Boolean).join(" · ");
  };
  const closePanels = (restoreFocus = false) => {
    const toggle = root.querySelector<HTMLButtonElement>(`[data-music-toggle="${openKind}"]`);
    root.querySelectorAll<HTMLElement>("[data-music-panel]").forEach(panel => { panel.hidden = true; });
    root.querySelectorAll<HTMLElement>("[data-music-toggle]").forEach(button => button.setAttribute("aria-expanded", "false"));
    openKind = "";
    if (restoreFocus) toggle?.focus({ preventScroll: true });
  };
  const positionPanel = (panel: HTMLElement) => {
    const available = () => (visualViewport ? visualViewport.height + visualViewport.offsetTop : innerHeight) - panel.getBoundingClientRect().top - 16;
    if (available() < 160) form.scrollIntoView({ block: "start", behavior: "instant" });
    panel.style.maxHeight = `${Math.max(80, available())}px`;
  };
  const resize = () => root.querySelectorAll<HTMLElement>("[data-music-panel]").forEach(panel => { if (!panel.hidden) positionPanel(panel); });
  window.addEventListener("resize", resize, { signal });
  window.visualViewport?.addEventListener("resize", resize, { signal });
  const setBusy = (busy: boolean) => {
    results().setAttribute("aria-busy", String(busy));
    more().setAttribute("aria-disabled", String(busy));
    if (busy && retryMore) {
      more().dataset.label ??= more().textContent ?? "";
      more().textContent = root.dataset.loading ?? "";
    } else if (more().dataset.label) {
      more().textContent = more().dataset.label!;
    }
    status.textContent = busy ? root.dataset.loading ?? "" : "";
  };
  const fetchResults = async (append = false) => {
    clearTimeout(timer);
    request?.abort();
    const current = ++serial;
    request = new AbortController();
    retryMore = append;
    error.hidden = true;
    setBusy(true);
    const nextParams = params();
    nextParams.set("page", append ? String(Number(results().dataset.page) + 1) : "1");
    const apiParams = new URLSearchParams(nextParams);
    apiParams.set("kind", root.dataset.kind!);
    try {
      const response = await fetch(`/api/music/browse?${apiParams}`, { signal: request.signal });
      if (!response.ok) throw new Error("Music query failed");
      const html = await response.text();
      if (current !== serial) return;
      const next = new DOMParser().parseFromString(html, "text/html").querySelector<HTMLElement>("[data-music-results]");
      if (!next) throw new Error("Missing music results");
      if (append && next.dataset.revision !== results().dataset.revision) {
        await fetchResults(false);
        return;
      }
      if (append) {
        const list = results().querySelector<HTMLElement>("[data-music-items]")!;
        const seen = new Set([...list.querySelectorAll<HTMLElement>("[data-music-id]")].map(item => item.dataset.musicId));
        next.querySelectorAll<HTMLElement>("[data-music-id]").forEach(item => {
          if (!seen.has(item.dataset.musicId)) { seen.add(item.dataset.musicId); list.appendChild(item); }
        });
        for (const key of ["total", "shown", "page", "batch", "hasMore", "revision"]) results().dataset[key] = next.dataset[key];
        const shown = list.children.length;
        const count = results().querySelector<HTMLElement>("[data-music-count]")!;
        count.textContent = count.dataset.template!.replaceAll("{shown}", String(shown)).replaceAll("{total}", next.dataset.total!);
        const nextMore = next.querySelector<HTMLAnchorElement>("[data-music-more]")!;
        more().href = nextMore.href;
        more().hidden = nextMore.hidden;
        if (more().hidden) { count.tabIndex = -1; count.focus({ preventScroll: true }); }
      } else {
        results().replaceWith(next);
      }
      setupReleaseCovers();
      const url = new URL(location.href);
      for (const key of ["q", "year", "classification", "type", "sort", "page", "batch"]) url.searchParams.delete(key);
      for (const [key, value] of nextParams) {
        if (key === "page" && value === "1") continue;
        url.searchParams.set(key, value);
      }
      history.replaceState(history.state, "", url);
      root.dataset.musicUrl = url.href;
      document.querySelectorAll<HTMLAnchorElement>("[data-music-entry]").forEach(entry => { entry.href = url.href; });
      try { sessionStorage.setItem(`music:list:${root.dataset.kind}`, `${url.pathname}${url.search}`); } catch { /* storage can be unavailable */ }
    } catch (cause) {
      if (current !== serial || (cause instanceof DOMException && cause.name === "AbortError")) return;
      error.hidden = false;
    } finally {
      if (current === serial) setBusy(false);
    }
  };
  const schedule = () => {
    request?.abort(); ++serial; clearTimeout(timer);
    retryMore = false;
    setBusy(true);
    if (!composing) timer = setTimeout(() => void fetchResults(), 300);
  };
  input.addEventListener("compositionstart", () => { composing = true; schedule(); }, { signal });
  input.addEventListener("compositionend", () => { composing = false; schedule(); }, { signal });
  input.addEventListener("input", schedule, { signal });
  form.addEventListener("change", () => { syncControls(); void fetchResults(); }, { signal });
  form.addEventListener("submit", event => {
    event.preventDefault(); closePanels();
    if (!composing) void fetchResults();
  }, { signal });
  root.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const moreLink = event.target.closest<HTMLAnchorElement>("[data-music-more]");
    if (moreLink) {
      if (event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
      event.preventDefault();
      if (moreLink.getAttribute("aria-disabled") !== "true") void fetchResults(true);
    }
    if (event.target.closest("[data-music-retry]")) void fetchResults(retryMore);
    if (event.target.closest("[data-music-close]")) closePanels(true);
    if (event.target.closest("[data-music-clear]")) {
      form.querySelectorAll("[data-music-filter]").forEach(select => { if (select instanceof HTMLSelectElement) select.value = ""; });
      syncControls(); void fetchResults();
    }
    const toggle = event.target.closest<HTMLButtonElement>("[data-music-toggle]");
    if (!toggle) return;
    const kind = toggle.dataset.musicToggle!;
    const open = openKind !== kind;
    closePanels();
    if (open) {
      openKind = kind;
      const panel = root.querySelector<HTMLElement>(`[data-music-panel="${kind}"]`)!;
      panel.hidden = false; toggle.setAttribute("aria-expanded", "true");
      positionPanel(panel);
      panel.querySelector<HTMLElement>('select, input:checked, button')?.focus({ preventScroll: true });
    }
  }, { signal });
  document.addEventListener("click", event => {
    if (event.target instanceof Element && !event.target.closest("[data-music-popover]")) closePanels();
  }, { signal });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && openKind) { event.preventDefault(); closePanels(true); }
  }, { signal });
  window.addEventListener("pagehide", () => { request?.abort(); ++serial; clearTimeout(timer); }, { signal });
  syncControls();
  if (root.dataset.kind === "releases") {
    matchMedia("(min-width: 1200px)").addEventListener("change", () => void fetchResults(), { signal });
  }
  const desiredBatch = root.dataset.kind === "releases" && matchMedia("(min-width: 1200px)").matches ? 8 : 6;
  if (Number(results().dataset.batch) !== desiredBatch) void fetchResults();
  dispose = () => {
    request?.abort(); ++serial; clearTimeout(timer); closePanels(); lifetime.abort();
  };
}


// Keep the public URLs and server-rendered fallback while swapping only the music area.
const musicPaths = ["/music/lives", "/music/songs", "/music/releases"];
const viewCache = new Map<string, { element: HTMLElement; url: string; title: string; scroll: number }>();
let navigationRequest: AbortController | undefined;
let navigationSerial = 0;

async function navigateMusicView(target: URL, push: boolean) {
  const current = document.querySelector<HTMLElement>("[data-music-browser]");
  if (!current) { location.assign(target.href); return; }
  const currentUrl = new URL(current.dataset.musicUrl || location.href);
  if (target.href === currentUrl.href && push) return;
  navigationRequest?.abort();
  const serial = ++navigationSerial;
  navigationRequest = new AbortController();
  const tabs = current.querySelector<HTMLElement>("[data-music-tabs]");
  tabs?.setAttribute("aria-busy", "true");
  current.querySelector<HTMLElement>("[data-music-status]")!.textContent = current.dataset.loading ?? "";
  try {
    const cached = viewCache.get(target.pathname);
    let next: HTMLElement;
    let title: string;
    let scroll = 0;
    if (cached?.url === target.href) {
      next = cached.element; title = cached.title; scroll = cached.scroll;
    } else {
      const response = await fetch(target, { signal: navigationRequest.signal });
      if (!response.ok) throw new Error("Music view failed");
      const document = new DOMParser().parseFromString(await response.text(), "text/html");
      const element = document.querySelector<HTMLElement>("[data-music-browser]");
      if (!element) throw new Error("Missing music view");
      // DOMParser disables scripting, so noscript fallback styles become real
      // nodes. Never adopt those styles into the JS-enhanced live document.
      element.querySelectorAll("noscript, script").forEach(node => node.remove());
      next = element; title = document.title;
    }
    if (serial !== navigationSerial) return;
    if (current.querySelector("[data-music-results]")?.getAttribute("aria-busy") !== "true") {
      viewCache.set(currentUrl.pathname, { element: current, url: currentUrl.href, title: document.title, scroll: window.scrollY });
    }
    if (push) history.pushState({ ...history.state, musicView: true }, "", target);
    current.replaceWith(next);
    document.title = title;
    setupMusicBrowser();
    next.querySelector<HTMLAnchorElement>("[data-music-tabs] a.active")?.focus({ preventScroll: true });
    setupReleaseCovers();
    requestAnimationFrame(() => window.scrollTo({ top: scroll, behavior: "instant" }));
  } catch (cause) {
    if (serial === navigationSerial && !(cause instanceof DOMException && cause.name === "AbortError")) location.assign(target.href);
  } finally {
    tabs?.removeAttribute("aria-busy");
    if (current.isConnected) current.querySelector<HTMLElement>("[data-music-status]")!.textContent = "";
  }
}

document.addEventListener("click", event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLAnchorElement>("[data-music-tabs] a");
  if (!link) return;
  let target = new URL(link.href);
  if (target.origin !== location.origin || !musicPaths.includes(target.pathname)) return;
  event.preventDefault();
  try {
    const kind = target.pathname.split("/").at(-1);
    const saved = sessionStorage.getItem(`music:list:${kind}`);
    if (saved) {
      const remembered = new URL(saved, location.origin);
      if (remembered.origin === location.origin && remembered.pathname === target.pathname) target = remembered;
    }
  } catch { /* retain the ordinary link target */ }
  const locale = document.querySelector<HTMLElement>("[data-music-browser]")?.dataset.locale;
  if (locale) target.searchParams.set("lang", locale);
  void navigateMusicView(target, true);
});
window.addEventListener("popstate", () => {
  if (musicPaths.includes(location.pathname)) void navigateMusicView(new URL(location.href), false);
});
