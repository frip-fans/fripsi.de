import { cancelContentEntry, playResultsEntry } from "./content-entry";
import { replacePublicUrl, publicUrl } from "./public-navigation";
let mounted: HTMLElement | null = null;
let dispose: (() => void) | undefined;
const snapshotsKey = "frip:event-search:v1";

export function setupEventSearch() {
  const root = document.querySelector<HTMLElement>("[data-event-list-view]");
  if (root === mounted) return;
  dispose?.();
  mounted = root;
  if (!root) return;
  const form = root.querySelector<HTMLFormElement>("[data-archive-filter-form]")!;
  const input = form.querySelector<HTMLInputElement>("[data-event-search-input]")!;
  const year = form.querySelector("[data-year-filter]") as HTMLElement & { value: string };
  const error = root.querySelector<HTMLElement>("[data-search-error]")!;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let request: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let serial = 0;
  let composing = false;
  let retryMore = false;
  const results = () => root.querySelector<HTMLElement>("[data-search-results]")!;
  const moreButton = () => root.querySelector<HTMLButtonElement>("[data-load-more]");
  const cache = new Map<string, { html: string; expires: number }>();
  const params = () => {
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (typeof value === "string" && value.trim()) next.append(key, value.trim());
    next.set("lang", root.dataset.locale!);
    next.set("view", "list");
    return next;
  };
  const syncControls = () => {
    const chosen = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')];
    const count = chosen.length + Number(Boolean(year.value));
    const badge = root.querySelector<HTMLElement>("[data-filter-count]")!;
    badge.textContent = String(count); badge.hidden = count === 0;
    root.querySelector<HTMLButtonElement>("[data-filter-toggle]")?.classList.toggle("active", count > 0);
    root.querySelector<HTMLButtonElement>("[data-filter-clear]")!.disabled = count === 0;
    const japanCount = chosen.filter(item => item.value.startsWith("jp:")).length;
    const japan = root.querySelector<HTMLElement>("[data-japan-selected]");
    if (japan) { japan.hidden = japanCount === 0; japan.textContent = japan.dataset.template!.replaceAll("{count}", String(japanCount)); }
    const sort = form.querySelector<HTMLInputElement>('input[name="sort"]:checked');
    const label = root.querySelector<HTMLElement>("[data-sort-button-label]");
    if (label) label.textContent = sort?.dataset.sortLabel ?? "";
  };
  const setBusy = (busy: boolean, more: boolean) => {
    results().setAttribute("aria-busy", String(busy));
    const button = moreButton();
    if (button) {
      button.disabled = busy;
      if (busy && more) { button.dataset.label = button.textContent ?? ""; button.textContent = root.dataset.loading!; }
      else if (button.dataset.label) { button.textContent = button.dataset.label; delete button.dataset.label; }
    }
  };
  const save = () => {
    if (!root.isConnected || root.closest<HTMLElement>("[data-search-pane]")?.hidden || results().getAttribute("aria-busy") === "true") return;
    const html = results().outerHTML;
    if (html.length > 512_000) return;
    try { sessionStorage.setItem(snapshotsKey, JSON.stringify({ url: publicUrl(), html, scroll: window.scrollY,
      revision: results().dataset.revision, expires: Date.now() + (results().dataset.revision ? 600_000 : 60_000) })); } catch { /* Storage can be unavailable/full. */ }
  };
  const restore = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(snapshotsKey) ?? "null");
      if (saved?.url !== location.href || saved.expires <= Date.now() || saved.revision !== results().dataset.revision) return;
      const parsed = new DOMParser().parseFromString(saved.html, "text/html").querySelector<HTMLElement>("[data-search-results]");
      if (!parsed) return;
      results().replaceWith(parsed);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!signal.aborted) window.scrollTo({ top: saved.scroll, behavior: "instant" });
      }));
    } catch { /* Ignore invalid snapshots. */ }
  };
  const closePanels = () => {
    root.querySelectorAll<HTMLElement>("[data-filter-panel], [data-sort-panel]").forEach(panel => { panel.hidden = true; });
    root.querySelectorAll<HTMLElement>("[data-filter-toggle], [data-sort-toggle]").forEach(button => button.setAttribute("aria-expanded", "false"));
  };
  const positionPanel = (panel: HTMLElement) => {
    if (!matchMedia("(max-width: 560px)").matches) { panel.style.removeProperty("max-height"); return; }
    const available = () => (visualViewport ? visualViewport.height + visualViewport.offsetTop : innerHeight) - panel.getBoundingClientRect().top - 16;
    if (available() < 160) form.scrollIntoView({ block: "start", behavior: "instant" });
    panel.style.maxHeight = `${Math.max(80, available())}px`;
  };
  const resizePanels = () => root.querySelectorAll<HTMLElement>("[data-filter-panel], [data-sort-panel]").forEach(panel => { if (!panel.hidden) positionPanel(panel); });
  window.addEventListener("resize", resizePanels, { signal });
  window.visualViewport?.addEventListener("resize", resizePanels, { signal });
  const fetchResults = async (more = false) => {
    clearTimeout(timer);
    request?.abort();
    cancelContentEntry(results());
    const current = ++serial;
    request = new AbortController();
    const nextParams = params();
    const url = more ? results().dataset.next! : `/api/events?${nextParams}`;
    if (!url) return;
    retryMore = more;
    error.hidden = true;
    setBusy(true, more);
    try {
      let html: string;
      const hit = cache.get(url);
      if (hit && hit.expires > Date.now()) html = hit.html;
      else {
        const response = await fetch(url, { signal: request.signal });
        if (!response.ok) throw new Error("Event search failed");
        html = await response.text();
      }
      if (current !== serial || signal.aborted) return;
      const next = new DOMParser().parseFromString(html, "text/html").querySelector<HTMLElement>("[data-search-results]");
      if (!next) throw new Error("Missing event results");
      // "More" continues from a keyset cursor (date, time, id), so it stays in order even when
      // the database changed; the revision moves on any unrelated write and must not reset the list.
      if (cache.size >= 12) cache.delete(cache.keys().next().value!);
      cache.set(url, { html, expires: Date.now() + 15_000 });
      if (more) {
        const list = results().querySelector<HTMLElement>("[data-event-items]")!;
        const seen = new Set([...list.querySelectorAll<HTMLAnchorElement>("h3 a")].map(link => link.pathname));
        next.querySelectorAll<HTMLElement>("[data-event-item]").forEach(item => {
          const href = item.querySelector<HTMLAnchorElement>("h3 a")?.pathname;
          if (!href || !seen.has(href)) list.appendChild(item);
        });
        results().dataset.next = next.dataset.next;
        results().dataset.total = next.dataset.total;
        const count = results().querySelector<HTMLElement>("[data-results-count]")!;
        count.textContent = count.dataset.template!.replaceAll("{shown}", String(list.children.length)).replaceAll("{total}", next.dataset.total!);
        moreButton()!.hidden = !next.dataset.next;
      } else {
        results().replaceWith(next);
        const url = new URL(location.href);
        for (const key of ["q", "year", "category", "location", "sort", "after"]) url.searchParams.delete(key);
        for (const [key, value] of nextParams) if (!["month", "lang", "view"].includes(key)) url.searchParams.append(key, value);
        replacePublicUrl(url);
      }
      if (!more) playResultsEntry(next);
      setBusy(false, more);
      save();
    } catch (cause) {
      if (current !== serial || signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) return;
      error.hidden = false;
    } finally { if (current === serial && !signal.aborted) setBusy(false, more); }
  };
  const schedule = () => {
    request?.abort(); ++serial; clearTimeout(timer);
    syncControls();
    // Disable pagination immediately while the new query is pending.
    setBusy(true, false);
    if (!composing) timer = setTimeout(() => void fetchResults(), 300);
  };
  input.addEventListener("compositionstart", () => { composing = true; schedule(); }, { signal });
  input.addEventListener("compositionend", () => { composing = false; schedule(); }, { signal });
  input.addEventListener("input", schedule, { signal });
  form.addEventListener("change", () => { syncControls(); void fetchResults(); }, { signal });
  form.addEventListener("submit", event => { event.preventDefault(); closePanels(); if (!composing) void fetchResults(); }, { signal });
  root.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const close = event.target.closest<HTMLElement>("[data-panel-close]");
    if (close) {
      closePanels();
      root.querySelector<HTMLElement>(`[data-${close.dataset.panelClose}-toggle]`)?.focus({ preventScroll: true });
    }
    if (event.target.closest("[data-load-more]")) void fetchResults(true);
    if (event.target.closest("[data-search-retry]")) void fetchResults(retryMore);
    if (event.target.closest("[data-filter-clear]")) {
      form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(item => { item.checked = false; });
      year.value = ""; syncControls(); void fetchResults();
    }
    for (const kind of ["filter", "sort"]) {
      const button = event.target.closest<HTMLElement>(`[data-${kind}-toggle]`);
      if (!button) continue;
      const panel = root.querySelector<HTMLElement>(`[data-${kind}-panel]`)!;
      const open = panel.hidden; closePanels(); panel.hidden = !open; button.setAttribute("aria-expanded", String(open));
      if (open) positionPanel(panel);
    }
  }, { signal });
  document.addEventListener("click", event => { if (event.target instanceof Element && !event.target.closest("[data-control-popover]")) closePanels(); }, { signal });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      const toggle = root.querySelector<HTMLElement>('[aria-expanded="true"]');
      closePanels(); toggle?.focus();
    }
  }, { signal });
  document.addEventListener("astro:before-preparation", save, { signal });
  document.addEventListener("astro:before-swap", () => { dispose?.(); mounted = null; }, { signal });
  window.addEventListener("pagehide", save, { signal });
  restore(); syncControls();
  dispose = () => { lifetime.abort(); request?.abort(); clearTimeout(timer); };
}
