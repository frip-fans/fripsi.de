export interface CatalogBrowserState {
  query: string;
  filter: string;
  sort: string;
  page: number;
}

interface CatalogBrowserLabels {
  summary: string;
  pagination: string;
  previous: string;
  next: string;
}

interface CatalogBrowserOptions<T> {
  root: HTMLElement;
  items: T[];
  pageSize: number;
  initialState: CatalogBrowserState;
  filterParam?: string;
  matches: (item: T, state: CatalogBrowserState) => boolean;
  compare: (left: T, right: T, sort: string) => number;
  renderCard: (item: T) => HTMLElement;
  labels: CatalogBrowserLabels;
}

const fillTemplate = (template: string, values: Record<string, string | number>) => Object.entries(values)
  .reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

export function setupPagedCatalog<T>(options: CatalogBrowserOptions<T>): void {
  const { root } = options;
  if (root.dataset.catalogReady === "true") return;
  root.dataset.catalogReady = "true";

  const grid = root.querySelector<HTMLElement>("[data-catalog-grid]");
  const empty = root.querySelector<HTMLElement>("[data-catalog-empty]");
  const summary = root.querySelector<HTMLElement>("[data-catalog-summary]");
  const pagination = root.querySelector<HTMLElement>("[data-catalog-pagination]");
  const paginationSummary = root.querySelector<HTMLElement>("[data-catalog-pagination-summary]");
  const pages = root.querySelector<HTMLElement>("[data-catalog-pages]");
  const searchForm = root.querySelector<HTMLFormElement>("[data-catalog-search-form]");
  const searchInput = root.querySelector<HTMLInputElement>("[data-catalog-search]");
  if (!grid || !empty || !summary || !pagination || !paginationSummary || !pages || !searchForm || !searchInput) return;

  const state = { ...options.initialState };

  const updateUrl = () => {
    const url = new URL(window.location.href);
    if (state.query) url.searchParams.set("q", state.query); else url.searchParams.delete("q");
    if (options.filterParam && state.filter) url.searchParams.set(options.filterParam, state.filter);
    else if (options.filterParam) url.searchParams.delete(options.filterParam);
    if (state.sort) url.searchParams.set("sort", state.sort); else url.searchParams.delete("sort");
    if (state.page > 1) url.searchParams.set("page", String(state.page)); else url.searchParams.delete("page");
    window.history.replaceState(null, "", url);
  };

  const updateControls = () => {
    root.querySelectorAll<HTMLElement>("[data-catalog-filter]").forEach((control) => {
      control.classList.toggle("active", (control.dataset.catalogFilter ?? "") === state.filter);
    });
    root.querySelectorAll<HTMLElement>("[data-catalog-sort]").forEach((control) => {
      control.classList.toggle("active", control.dataset.catalogSort === state.sort);
    });
  };

  const renderPagination = (totalItems: number, totalPages: number) => {
    pagination.hidden = totalPages <= 1;
    paginationSummary.textContent = fillTemplate(options.labels.pagination, {
      total: totalItems,
      current: state.page,
      pages: totalPages,
    });
    pages.replaceChildren();

    const addButton = (label: string, targetPage: number, className: string, disabled = false, current = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = label;
      button.disabled = disabled;
      button.dataset.page = String(targetPage);
      if (current) button.setAttribute("aria-current", "page");
      pages.appendChild(button);
    };

    addButton(options.labels.previous, state.page - 1, "music-page-step", state.page <= 1);
    type PageToken = number | "ellipsis-start" | "ellipsis-end";
    const pageTokens: PageToken[] = totalPages <= 7
      ? Array.from({ length: totalPages }, (_, index) => index + 1)
      : state.page <= 4
        ? [1, 2, 3, 4, 5, "ellipsis-end", totalPages]
        : state.page >= totalPages - 3
          ? [1, "ellipsis-start", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
          : [1, "ellipsis-start", state.page - 1, state.page, state.page + 1, "ellipsis-end", totalPages];
    for (const token of pageTokens) {
      if (typeof token === "number") {
        addButton(String(token), token, "music-page-number", false, token === state.page);
      } else {
        const ellipsis = document.createElement("span");
        ellipsis.className = "music-page-ellipsis";
        ellipsis.textContent = "…";
        ellipsis.setAttribute("aria-hidden", "true");
        pages.appendChild(ellipsis);
      }
    }
    addButton(options.labels.next, state.page + 1, "music-page-step", state.page >= totalPages);
  };

  const render = (updateHistory = true) => {
    const filtered = options.items
      .filter((item) => options.matches(item, state))
      .sort((left, right) => options.compare(left, right, state.sort));
    const totalPages = Math.max(1, Math.ceil(filtered.length / options.pageSize));
    state.page = Math.min(Math.max(1, state.page), totalPages);
    const visible = filtered.slice((state.page - 1) * options.pageSize, state.page * options.pageSize);
    grid.replaceChildren(...visible.map(options.renderCard));
    empty.hidden = visible.length > 0;
    summary.textContent = fillTemplate(options.labels.summary, { visible: filtered.length, total: options.items.length });
    renderPagination(filtered.length, totalPages);
    updateControls();
    if (updateHistory) updateUrl();
  };

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.query = searchInput.value.trim();
    state.page = 1;
    render();
  });
  searchInput.addEventListener("input", () => {
    state.query = searchInput.value.trim();
    state.page = 1;
    render();
  });
  root.querySelector("[data-catalog-filters]")?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLAnchorElement>("[data-catalog-filter]");
    if (!control) return;
    event.preventDefault();
    state.filter = control.dataset.catalogFilter ?? "";
    state.page = 1;
    render();
  });
  root.querySelector("[data-catalog-sorts]")?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLAnchorElement>("[data-catalog-sort]");
    if (!control) return;
    event.preventDefault();
    state.sort = control.dataset.catalogSort ?? "";
    state.page = 1;
    render();
  });
  pages.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLButtonElement) || event.target.disabled) return;
    const targetPage = Number(event.target.dataset.page);
    if (!Number.isFinite(targetPage)) return;
    state.page = targetPage;
    render();
    grid.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });

  render(false);
}
