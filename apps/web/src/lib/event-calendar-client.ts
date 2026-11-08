import { calendarAgendaHref } from "./calendar-navigation";
let calendarController: AbortController | undefined;
export const setupCalendar = () => {
  calendarController?.abort();
  calendarController = new AbortController();
  const { signal } = calendarController;
  const calendar = document.querySelector<HTMLElement>("[data-event-calendar-view]");
  if (!calendar) return;
  const picker = calendar.querySelector<HTMLDetailsElement>("[data-month-picker]");
  const yearSelect = picker?.querySelector("[data-picker-year]") as (HTMLElement & { value: string }) | null | undefined;
  const monthLinks = picker?.querySelectorAll<HTMLAnchorElement>("[data-picker-month]");
  const selectedMonth = picker?.dataset.selectedMonth ?? "";
  const todayMonth = picker?.dataset.todayMonth ?? "";
  const renderPickerYear = () => monthLinks?.forEach((link) => {
    const value = `${yearSelect?.value}-${String(link.dataset.pickerMonth).padStart(2, "0")}`;
    const params = new URLSearchParams(location.search);
    params.set("month", value);
    if (value !== selectedMonth) params.delete("calendar");
    link.href = calendarAgendaHref(params, todayMonth);
    link.classList.toggle("active", value === selectedMonth);
    link.classList.toggle("current", value === todayMonth);
    if (value === selectedMonth) link.setAttribute("aria-current", "date");
    else link.removeAttribute("aria-current");
  });
  yearSelect?.addEventListener("change", renderPickerYear, { signal });
  const overview = calendar.querySelector<HTMLDetailsElement>("[data-calendar-overview]");
  overview?.addEventListener("toggle", () => {
    const label = overview.querySelector<HTMLElement>("[data-overview-label]");
    if (label) label.textContent = (overview.open ? label.dataset.openLabel : label.dataset.closedLabel) ?? "";
    const url = new URL(location.href);
    if (overview.open) url.searchParams.set("calendar", "1");
    else url.searchParams.delete("calendar");
    history.replaceState(history.state, "", url);
    const form = calendar.querySelector<HTMLFormElement>(".category-panel");
    const expandedInput = form?.querySelector<HTMLInputElement>('input[name="calendar"]');
    if (expandedInput) expandedInput.value = overview.open ? "1" : "0";
    renderPickerYear();
  }, { signal });
  const jumps = calendar.querySelectorAll<HTMLAnchorElement>("[data-calendar-jump]");
  const syncAnchor = () => jumps.forEach((link) => {
    if (link.hash === location.hash) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
  jumps.forEach((link) => link.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(link.hash.slice(1));
    if (!target) return;
    event.preventDefault();
    if (location.hash !== link.hash) history.pushState(history.state, "", link.href);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    syncAnchor();
  }, { signal }));
  window.addEventListener("hashchange", syncAnchor, { signal });
  // Old shared day links now locate a group instead of filtering the month.
  const url = new URL(location.href);
  const oldDate = url.searchParams.get("date");
  if (oldDate) {
    url.searchParams.delete("date");
    if (!url.hash && document.getElementById(`agenda-${oldDate}`)) url.hash = `agenda-${oldDate}`;
    history.replaceState(history.state, "", url);
  }
  if (matchMedia("(max-width: 800px)").matches && /^#agenda-\d{4}-\d{2}-\d{2}$/.test(location.hash)) {
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  syncAnchor();
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Node)) return;
    calendar.querySelectorAll<HTMLDetailsElement>("[data-month-picker], [data-category-picker]").forEach((details) => {
      if (!details.contains(event.target as Node)) details.open = false;
    });
  }, { signal });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    calendar.querySelectorAll<HTMLDetailsElement>("[data-month-picker][open], [data-category-picker][open]").forEach((details) => {
      details.open = false;
      details.querySelector<HTMLElement>("summary")?.focus();
    });
  }, { signal });
};
