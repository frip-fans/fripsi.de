import { isMusicPath, setupMusicBackLink } from "./music-navigation";
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


// One document for the music lists and details; normal links remain the fallback.
const viewCache = new Map<string, { element: HTMLElement; title: string; scroll: number; source: string | null; description: string; canonical: string }>();
let navigationRequest: AbortController | undefined;
let navigationSerial = 0;
let renderedUrl = location.href;
let renderedSource: string | null = history.state?.musicSource ?? (document.referrer || null);
const musicRoot = () => document.querySelector<HTMLElement>("[data-music-browser], [data-music-detail]");

async function navigateMusicView(target: URL, push: boolean, returning = false) {
  const current = musicRoot();
  if (!current) { location.assign(target.href); return; }
  const currentUrl = current.dataset.musicUrl || renderedUrl;
  if (target.href === currentUrl && push) return;
  navigationRequest?.abort();
  const serial = ++navigationSerial;
  navigationRequest = new AbortController();
  current.setAttribute("aria-busy", "true");
  try {
    const cached = viewCache.get(target.href);
    let next: HTMLElement;
    let title: string;
    let scroll = 0;
    let description = cached?.description ?? "";
    let canonical = cached?.canonical ?? "";
    let source = push ? (returning ? cached?.source ?? null : new URL(currentUrl).pathname === target.pathname ? renderedSource : currentUrl) : history.state?.musicSource ?? cached?.source ?? null;
    if (cached) {
      next = cached.element; title = cached.title; scroll = cached.scroll;
    } else {
      const response = await fetch(target, { signal: navigationRequest.signal });
      if (!response.ok) throw new Error("Music view failed");
      const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
      const element = parsed.querySelector<HTMLElement>("[data-music-browser], [data-music-detail]");
      if (!element) throw new Error("Missing music view");
      element.querySelectorAll("noscript, script").forEach(node => node.remove());
      // Page-specific Astro CSS must be available before showing the next view.
      const styles: Promise<void>[] = [];
      for (const style of parsed.head.querySelectorAll('link[rel="stylesheet"], style')) {
        if (style instanceof HTMLLinkElement) {
          const href = style.getAttribute("href")!;
          if ([...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].some(existing => existing.getAttribute("href") === href)) continue;
          const link = style.cloneNode(true) as HTMLLinkElement;
          styles.push(new Promise((resolve, reject) => { link.onload = () => resolve(); link.onerror = () => reject(new Error("Music styles failed")); }));
          document.head.appendChild(link);
        } else if (![...document.head.querySelectorAll("style")].some(existing => existing.textContent === style.textContent)) {
          document.head.appendChild(style.cloneNode(true));
        }
      }
      await Promise.all(styles);
      next = element; title = parsed.title;
      description = parsed.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? "";
      canonical = parsed.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? "";
    }
    if (serial !== navigationSerial) return;
    if (current.querySelector("[data-music-results]")?.getAttribute("aria-busy") !== "true") {
      viewCache.set(currentUrl, { element: current, title: document.title, scroll: window.scrollY, source: renderedSource, description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? "", canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? "" });
      if (viewCache.size > 20) viewCache.delete(viewCache.keys().next().value!);
    }
    dispose?.(); mounted = null;
    if (push) history.pushState({ musicView: true, musicSource: source }, "", target);
    current.replaceWith(next);
    next.removeAttribute("aria-busy");
    document.title = title;
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", description);
    if (canonical) document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute("href", canonical);
    renderedUrl = target.href; renderedSource = source;
    setupMusicBrowser();
    setupMusicBackLink(source);
    setupReleaseCovers();
    const heading = next.querySelector<HTMLElement>("h1");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    requestAnimationFrame(() => {
      const anchor = target.hash ? document.getElementById(decodeURIComponent(target.hash.slice(1))) : null;
      if (anchor) anchor.scrollIntoView({ block: "start" });
      else window.scrollTo({ top: scroll, behavior: "instant" });
    });
  } catch (cause) {
    if (serial === navigationSerial && !(cause instanceof DOMException && cause.name === "AbortError")) location.assign(target.href);
  } finally {
    current.removeAttribute("aria-busy");
  }
}

document.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLAnchorElement>("a[href]");
  if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self") || !musicRoot()) return;
  let target = new URL(link.href);
  if (target.origin !== location.origin || !isMusicPath(target.pathname)) return;
  if (target.pathname === location.pathname && target.search === location.search && target.hash) return;
  if (link.closest("[data-music-tabs]")) {
    try {
      const kind = target.pathname.split("/").at(-1);
      const saved = sessionStorage.getItem(`music:list:${kind}`);
      if (saved) {
        const remembered = new URL(saved, location.origin);
        if (remembered.origin === location.origin && remembered.pathname === target.pathname) target = remembered;
      }
    } catch { /* retain the ordinary link target */ }
  }
  const locale = new URL(location.href).searchParams.get("lang");
  if (locale && !target.searchParams.has("lang")) target.searchParams.set("lang", locale);
  // Locale changes also update the site chrome through ordinary navigation.
  if (target.searchParams.has("lang") && target.searchParams.get("lang") !== document.documentElement.lang) return;
  event.preventDefault();
  void navigateMusicView(target, true, link.hasAttribute("data-music-back"));
});
window.addEventListener("popstate", () => {
  if (isMusicPath(location.pathname) && musicRoot()) void navigateMusicView(new URL(location.href), false);
});
