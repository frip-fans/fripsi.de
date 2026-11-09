import { searchMatcher } from "@frip-fan/core/search-text";
import { clampPage, HISTORY_PAGE_SIZE, pageTokens } from "./page-tokens";
import { replacePublicUrl } from "./public-navigation";

/** Year bars, the search box and page links filter the performance history in place; the URL keeps the state. */
export function setupSongDetail(): void {
  const root = document.querySelector<HTMLElement>("[data-song-detail]");
  if (!root || root.dataset.songReady) return;
  root.dataset.songReady = "true";
  const rows = [...root.querySelectorAll<HTMLElement>("[data-performance]")];
  const chart = root.querySelector<HTMLElement>("[data-year-chart]");
  const bars = [...root.querySelectorAll<HTMLButtonElement>("[data-year-bar]")];
  const labels = [...root.querySelectorAll<HTMLElement>("[data-year-label]")];
  const chips = [...root.querySelectorAll<HTMLButtonElement>("[data-version-chip]")];
  const search = root.querySelector<HTMLInputElement>("[data-history-search]");
  const count = root.querySelector<HTMLElement>("[data-history-count]");
  const showAll = root.querySelector<HTMLButtonElement>("[data-history-show-all]");
  const pager = root.querySelector<HTMLElement>("[data-history-pager]");
  const empty = root.querySelector<HTMLElement>("[data-history-empty]");
  root.querySelectorAll<HTMLElement>("[data-js-only]").forEach((element) => { element.hidden = false; });

  const params = new URL(location.href).searchParams;
  let year = bars.some((bar) => bar.dataset.yearBar === params.get("year") && !bar.disabled) ? params.get("year") : null;
  let query = (params.get("q") ?? "").slice(0, 100);
  let version = chips.some((chip) => chip.dataset.versionChip === params.get("version")) ? params.get("version") : null;
  let page = Number(params.get("page") ?? "1");
  if (search) search.value = query;

  const pageUrl = (target: number) => {
    const url = new URL(location.href);
    url.hash = "";
    for (const key of ["version", "year", "q", "page"]) url.searchParams.delete(key);
    if (version) url.searchParams.set("version", version);
    if (year) url.searchParams.set("year", year);
    if (query.trim()) url.searchParams.set("q", query.trim());
    if (target > 1) url.searchParams.set("page", String(target));
    return url;
  };

  const renderPager = (pages: number) => {
    if (!pager) return;
    pager.hidden = pages <= 1;
    while (pager.firstChild) pager.removeChild(pager.firstChild);
    const step = (target: number, symbol: string, label: string, rel: string) => {
      const enabled = target >= 1 && target <= pages;
      const element = document.createElement(enabled ? "a" : "span");
      element.className = enabled ? "song-pager-step" : "song-pager-step is-disabled";
      element.textContent = symbol;
      if (enabled) {
        (element as HTMLAnchorElement).href = pageUrl(target).href;
        element.dataset.page = String(target);
        element.setAttribute("rel", rel);
        element.setAttribute("aria-label", label);
      } else element.setAttribute("aria-hidden", "true");
      return element;
    };
    pager.appendChild(step(page - 1, "‹", pager.dataset.labelPrevious ?? "", "prev"));
    for (const token of pageTokens(page, pages)) {
      if (typeof token === "number") {
        const link = document.createElement("a");
        link.className = "song-pager-number";
        link.href = pageUrl(token).href;
        link.dataset.page = String(token);
        link.textContent = String(token);
        if (token === page) link.setAttribute("aria-current", "page");
        pager.appendChild(link);
      } else {
        const gap = document.createElement("span");
        gap.className = "song-pager-gap";
        gap.setAttribute("aria-hidden", "true");
        gap.textContent = "…";
        pager.appendChild(gap);
      }
    }
    const status = document.createElement("span");
    status.className = "song-pager-status";
    status.setAttribute("aria-hidden", "true");
    status.textContent = `${page} / ${pages}`;
    pager.appendChild(status);
    pager.appendChild(step(page + 1, "›", pager.dataset.labelNext ?? "", "next"));
  };

  const render = () => {
    const needle = query.trim();
    const matchesQuery = searchMatcher(needle);
    const filtered = Boolean(version || year || needle);
    const matches = rows.filter((row) => (!version || row.dataset.version === version) && (!year || row.dataset.year === year) && matchesQuery(row.dataset.search ?? ""));
    const pages = Math.max(1, Math.ceil(matches.length / HISTORY_PAGE_SIZE));
    page = clampPage(page, pages);
    const visible = new Set(matches.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE));
    for (const row of rows) row.hidden = !visible.has(row);
    if (empty) empty.hidden = matches.length > 0;
    if (showAll) showAll.hidden = !filtered;
    if (count) {
      const versionLabel = chips.find((chip) => chip.dataset.versionChip === version)?.dataset.versionLabel ?? "";
      const scope = [versionLabel, year ? (count.dataset.templateYear ?? "{year}").replace("{year}", year) : "", needle ? `“${query.trim()}”` : ""].filter(Boolean).join(" · ");
      const template = filtered ? count.dataset.templateFiltered ?? "" : count.dataset.templateAll ?? "";
      count.textContent = template.replace("{scope}", scope).replace("{count}", String(filtered ? matches.length : rows.length));
    }
    for (const bar of bars) {
      bar.setAttribute("aria-pressed", String(bar.dataset.yearBar === year));
      // With a version selected, the label counts only that version's shows; segments of other versions fade.
      const sung = bar.querySelector<HTMLElement>("[data-bar-sung]");
      if (sung) {
        let counts: Record<string, number> = {};
        try { counts = JSON.parse(bar.dataset.versionCounts ?? "{}"); } catch { /* keep empty */ }
        sung.textContent = version ? String(counts[version] ?? 0) : bar.dataset.sung ?? "0";
      }
      bar.querySelectorAll<HTMLElement>("[data-segment]").forEach((segment) => segment.classList.toggle("is-on", Boolean(version) && segment.dataset.segment === version));
    }
    chart?.toggleAttribute("data-version-selected", Boolean(version));
    for (const chip of chips) chip.setAttribute("aria-pressed", String(chip.dataset.versionChip === version));
    chart?.toggleAttribute("data-selected", Boolean(year));
    for (const label of labels) label.classList.toggle("is-active", label.dataset.yearLabel === year);
    renderPager(pages);
    const url = pageUrl(page);
    if (url.href !== location.href) replacePublicUrl(url);
  };

  for (const bar of bars) {
    const label = labels.find((item) => item.dataset.yearLabel === bar.dataset.yearBar);
    bar.addEventListener("click", () => {
      year = year === bar.dataset.yearBar ? null : bar.dataset.yearBar ?? null;
      page = 1;
      render();
    });
    // Hovered or focused years show their axis label; anchor years are always labelled.
    const peek = (on: boolean) => label?.classList.toggle("is-active", on || label.dataset.yearLabel === year);
    bar.addEventListener("pointerenter", () => peek(true));
    bar.addEventListener("pointerleave", () => peek(false));
    bar.addEventListener("focus", () => peek(true));
    bar.addEventListener("blur", () => peek(false));
  }
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      version = version === chip.dataset.versionChip ? null : chip.dataset.versionChip ?? null;
      page = 1;
      render();
    });
  }
  search?.addEventListener("input", () => { query = search.value.slice(0, 100); page = 1; render(); });
  showAll?.addEventListener("click", () => {
    version = null;
    year = null;
    query = "";
    page = 1;
    if (search) search.value = "";
    render();
    search?.focus({ preventScroll: true });
  });
  pager?.addEventListener("click", (event) => {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[data-page]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    const target = link.dataset.page;
    const wasFocused = document.activeElement === link;
    page = Number(target);
    render();
    // Pages keep a fixed height, so the pager stays put: no scrolling, and keyboard focus returns to the same page link.
    if (wasFocused) {
      const same = pager.querySelector<HTMLElement>(`a[data-page="${target}"]`) ?? pager.querySelector<HTMLElement>('[aria-current="page"]');
      same?.focus({ preventScroll: true });
    }
  });
  render();
}
