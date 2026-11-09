import { replacePublicUrl } from "./public-navigation";

const PAGE_SIZE = 10;
const MORE_STEP = 20;

/** Year bars and the search box filter the performance history in place; the URL keeps the filter. */
export function setupSongDetail(): void {
  const root = document.querySelector<HTMLElement>("[data-song-detail]");
  if (!root || root.dataset.songReady) return;
  root.dataset.songReady = "true";
  const rows = [...root.querySelectorAll<HTMLElement>("[data-performance]")];
  const chart = root.querySelector<HTMLElement>("[data-year-chart]");
  const bars = [...root.querySelectorAll<HTMLButtonElement>("[data-year-bar]")];
  const labels = [...root.querySelectorAll<HTMLElement>("[data-year-label]")];
  const search = root.querySelector<HTMLInputElement>("[data-history-search]");
  const count = root.querySelector<HTMLElement>("[data-history-count]");
  const showAll = root.querySelector<HTMLButtonElement>("[data-history-show-all]");
  const more = root.querySelector<HTMLButtonElement>("[data-history-more]");
  const empty = root.querySelector<HTMLElement>("[data-history-empty]");
  root.querySelectorAll<HTMLElement>("[data-js-only]").forEach((element) => { element.hidden = false; });
  rows.forEach((row) => row.classList.remove("is-collapsed"));

  const params = new URL(location.href).searchParams;
  let year = bars.some((bar) => bar.dataset.yearBar === params.get("year") && !bar.disabled) ? params.get("year") : null;
  let query = (params.get("q") ?? "").slice(0, 100);
  if (search) search.value = query;
  let limit = PAGE_SIZE;

  const syncUrl = () => {
    const url = new URL(location.href);
    url.searchParams.delete("year");
    url.searchParams.delete("q");
    if (year) url.searchParams.set("year", year);
    if (query.trim()) url.searchParams.set("q", query.trim());
    if (url.href !== location.href) replacePublicUrl(url);
  };

  const render = () => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = Boolean(year || needle);
    let matches = 0;
    for (const row of rows) {
      const match = (!year || row.dataset.year === year) && (!needle || (row.dataset.search ?? "").includes(needle));
      if (match) matches++;
      row.hidden = !match || (!filtered && matches > limit);
    }
    if (empty) empty.hidden = matches > 0;
    if (more) more.hidden = filtered || rows.length <= limit;
    if (showAll) showAll.hidden = !filtered;
    if (count) {
      const scope = [year ? (count.dataset.templateYear ?? "{year}").replace("{year}", year) : "", needle ? `“${query.trim()}”` : ""].filter(Boolean).join(" · ");
      const template = filtered ? count.dataset.templateFiltered ?? "" : count.dataset.templateAll ?? "";
      count.textContent = template.replace("{scope}", scope).replace("{count}", String(filtered ? matches : rows.length));
    }
    for (const bar of bars) bar.setAttribute("aria-pressed", String(bar.dataset.yearBar === year));
    chart?.toggleAttribute("data-selected", Boolean(year));
    for (const label of labels) label.classList.toggle("is-active", label.dataset.yearLabel === year);
    syncUrl();
  };

  for (const bar of bars) {
    const label = labels.find((item) => item.dataset.yearLabel === bar.dataset.yearBar);
    bar.addEventListener("click", () => {
      year = year === bar.dataset.yearBar ? null : bar.dataset.yearBar ?? null;
      limit = PAGE_SIZE;
      render();
    });
    // Hovered or focused years show their axis label; anchor years are always labelled.
    const peek = (on: boolean) => label?.classList.toggle("is-active", on || label.dataset.yearLabel === year);
    bar.addEventListener("pointerenter", () => peek(true));
    bar.addEventListener("pointerleave", () => peek(false));
    bar.addEventListener("focus", () => peek(true));
    bar.addEventListener("blur", () => peek(false));
  }
  search?.addEventListener("input", () => { query = search.value.slice(0, 100); limit = PAGE_SIZE; render(); });
  showAll?.addEventListener("click", () => {
    year = null;
    query = "";
    if (search) search.value = "";
    limit = PAGE_SIZE;
    render();
    search?.focus({ preventScroll: true });
  });
  more?.addEventListener("click", () => { limit += MORE_STEP; render(); });
  render();
}
