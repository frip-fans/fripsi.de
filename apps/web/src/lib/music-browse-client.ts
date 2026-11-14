import { cancelContentEntry, playResultsEntry } from "./content-entry";
import { replacePublicUrl } from "./public-navigation";
import { setupReleaseCovers } from "../scripts/release-cover";
import { MUSIC_WIDE_RELEASE_BATCH_SIZE, MUSIC_WIDE_RELEASE_QUERY, musicBatchSize } from "./music-batch";

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
    if (root.dataset.kind === "releases" && matchMedia(MUSIC_WIDE_RELEASE_QUERY).matches) next.set("batch", String(MUSIC_WIDE_RELEASE_BATCH_SIZE));
    // Checkbox filters repeat their name, so keep every value instead of the last one.
    for (const [key, value] of new FormData(form)) {
      if (typeof value === "string" && value.trim()) next.append(key, value.trim());
    }
    return next;
  };
  const syncControls = () => {
    const count = form.querySelectorAll<HTMLInputElement>("input[data-music-filter]:checked").length;
    const clear = root.querySelector<HTMLButtonElement>("[data-music-clear]");
    if (clear) clear.hidden = count === 0;
    const sort = form.querySelector<HTMLInputElement>('input[name="sort"]:checked');
    root.querySelector<HTMLElement>("[data-music-sort-label]")!.textContent = sort?.dataset.sortLabel ?? "";
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
  /** `page` reloads that many batches at once; appending always asks for the next one. */
  const fetchResults = async (append = false, page = 1) => {
    clearTimeout(timer);
    request?.abort();
    cancelContentEntry(results());
    const current = ++serial;
    request = new AbortController();
    retryMore = append;
    error.hidden = true;
    setBusy(true);
    const nextParams = params();
    nextParams.set("page", append ? String(Number(results().dataset.page) + 1) : String(page));
    const apiParams = new URLSearchParams(nextParams);
    apiParams.set("kind", root.dataset.kind!);
    if (!append && page > 1) apiParams.set("full", "1");
    try {
      const response = await fetch(`/api/music/browse?${apiParams}`, { signal: request.signal });
      if (!response.ok) throw new Error("Music query failed");
      const html = await response.text();
      if (current !== serial) return;
      const next = new DOMParser().parseFromString(html, "text/html").querySelector<HTMLElement>("[data-music-results]");
      if (!next) throw new Error("Missing music results");
      const list = results().querySelector<HTMLElement>("[data-music-items]")!;
      // The list changed under the loaded items (new or removed entries before this batch):
      // reload every batch up to the requested one instead of stitching mismatched pages.
      if (append && next.dataset.anchor !== [...list.querySelectorAll<HTMLElement>("a[data-music-id]")].at(-1)?.dataset.musicId) {
        await fetchResults(false, Number(next.dataset.page));
        return;
      }
      if (append) {
        const seen = new Set([...list.querySelectorAll<HTMLElement>("[data-music-id]")].map(item => item.dataset.musicId));
        next.querySelectorAll<HTMLElement>("[data-music-id]").forEach(item => {
          if (!seen.has(item.dataset.musicId)) { seen.add(item.dataset.musicId); list.appendChild(item); }
        });
        for (const key of ["total", "shown", "page", "batch", "hasMore", "anchor"]) results().dataset[key] = next.dataset[key];
        const shown = list.querySelectorAll("a[data-music-id]").length;
        const count = results().querySelector<HTMLElement>("[data-music-count]")!;
        count.textContent = count.dataset.template!.replaceAll("{shown}", String(shown)).replaceAll("{total}", next.dataset.total!);
        const nextMore = next.querySelector<HTMLAnchorElement>("[data-music-more]")!;
        more().href = nextMore.href;
        more().hidden = nextMore.hidden;
        if (more().hidden) { count.tabIndex = -1; count.focus({ preventScroll: true }); }
      } else {
        results().replaceWith(next);
      }
      if (!append) playResultsEntry(next);
      setupReleaseCovers();
      const url = new URL(location.href);
      for (const key of new Set(["q", "year", "classification", "type", "phase", "sort", "page", "batch", ...nextParams.keys()])) url.searchParams.delete(key);
      for (const [key, value] of nextParams) {
        if (key === "page" && value === "1") continue;
        url.searchParams.append(key, value);
      }
      replacePublicUrl(url);
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
    const olderToggle = event.target.closest<HTMLButtonElement>("[data-music-older-toggle]");
    if (olderToggle) {
      const expanded = olderToggle.getAttribute("aria-expanded") !== "true";
      olderToggle.setAttribute("aria-expanded", String(expanded));
      root.querySelector<HTMLElement>(`#${olderToggle.getAttribute("aria-controls")}`)?.toggleAttribute("data-expanded", expanded);
      const label = olderToggle.querySelector<HTMLElement>("[data-music-older-label]");
      if (label) label.textContent = (expanded ? olderToggle.dataset.labelLess : olderToggle.dataset.labelMore) ?? "";
    }
    if (event.target.closest("[data-music-close]")) closePanels(true);
    if (event.target.closest("[data-music-clear]")) {
      form.querySelectorAll<HTMLInputElement>("input[data-music-filter]").forEach(input => { input.checked = false; });
      syncControls(); void fetchResults();
      form.querySelector<HTMLInputElement>("input[data-music-filter]")?.focus({ preventScroll: true });
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
      panel.querySelector<HTMLElement>('input:checked, button')?.focus({ preventScroll: true });
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
  // On phones the chips scroll sideways; bring the last selected chip into view.
  const chipScroll = root.querySelector<HTMLElement>(".music-chip-scroll");
  const lastChecked = [...(chipScroll?.querySelectorAll<HTMLElement>("input[data-music-filter]:checked") ?? [])].at(-1)?.closest<HTMLElement>(".music-chip");
  if (chipScroll && lastChecked && chipScroll.scrollWidth > chipScroll.clientWidth) {
    chipScroll.scrollLeft = lastChecked.offsetLeft - chipScroll.offsetLeft - (chipScroll.clientWidth - lastChecked.offsetWidth) / 2;
  }
  if (root.dataset.kind === "releases") {
    matchMedia(MUSIC_WIDE_RELEASE_QUERY).addEventListener("change", () => void fetchResults(), { signal });
  }
  const desiredBatch = musicBatchSize(root.dataset.kind, root.dataset.kind === "releases" && matchMedia(MUSIC_WIDE_RELEASE_QUERY).matches);
  if (Number(results().dataset.batch) !== desiredBatch) void fetchResults();
  dispose = () => {
    request?.abort(); ++serial; clearTimeout(timer); closePanels(); lifetime.abort();
  };
}


document.addEventListener("astro:page-load", setupMusicBrowser);
document.addEventListener("astro:before-swap", () => { dispose?.(); mounted = null; });
setupMusicBrowser();
