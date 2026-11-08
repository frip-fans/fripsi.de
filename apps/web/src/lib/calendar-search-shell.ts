import { calendarAgendaHref, calendarViewHref } from "./calendar-navigation";
import { setupCalendar } from "./event-calendar-client";
import { setupEventSearch } from "./event-search-client";
let controller: AbortController | undefined;
function setupShell() {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const shell = document.querySelector<HTMLElement>("[data-calendar-shell]");
  if (!shell) { setupEventSearch(); return; }
  const calendar = shell.querySelector<HTMLElement>("[data-calendar-pane]")!;
  const search = shell.querySelector<HTMLElement>("[data-search-pane]")!;
  let calendarUrl = calendarAgendaHref(new URLSearchParams(location.search), shell.dataset.todayMonth!);
  let searchUrl = calendarViewHref(new URLSearchParams(location.search), "list", "");
  let calendarScroll = 0;
  let searchScroll = 0;
  let loading: AbortController | undefined;
  const show = (mode: string) => {
    shell.dataset.mode = mode;
    calendar.hidden = mode === "list"; search.hidden = mode !== "list";
    const title = shell.querySelector<HTMLElement>("[data-calendar-title]")!;
    title.textContent = mode === "list" ? title.dataset.searchLabel! : title.dataset.calendarLabel!;
    const toggle = shell.querySelector<HTMLAnchorElement>("[data-search-toggle]")!;
    toggle.hidden = mode === "list";
    shell.querySelector<HTMLElement>("[data-calendar-subscribe]")!.hidden = mode === "list";
    toggle.href = searchUrl;
    const back = shell.querySelector<HTMLAnchorElement>("[data-agenda-return]")!;
    back.hidden = mode !== "list"; back.href = calendarUrl;
  };
  document.addEventListener("click", async event => {
    if (!(event.target instanceof Element) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest<HTMLAnchorElement>("[data-calendar-view], [data-agenda-return]");
    if (!link || !shell.contains(link)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const mode = link.hasAttribute("data-agenda-return") ? "calendar" : link.dataset.calendarView!;
    if (mode === shell.dataset.mode) return;
    loading?.abort(); loading = new AbortController();
    const pending = loading;
    const error = shell.querySelector<HTMLElement>("[data-shell-error]")!;
    error.hidden = true;
    link.setAttribute("aria-busy", "true");
    try {
      if (shell.dataset.mode === "calendar") {
        calendarUrl = location.pathname + location.search + location.hash; calendarScroll = window.scrollY;
      } else {
        document.dispatchEvent(new Event("frip:search-leaving"));
        searchUrl = location.pathname + location.search; searchScroll = window.scrollY;
      }
      const pane = mode === "list" ? search : calendar;
      const target = mode === "list" ? searchUrl : calendarUrl;
      if (!pane.children.length) {
        const url = new URL(target, location.origin);
        url.searchParams.set("lang", shell.dataset.locale!);
        url.pathname = mode === "list" ? "/api/event-search" : "/api/calendar-month";
        const response = await fetch(url, { signal: pending.signal });
        if (!response.ok) throw new Error("Pane failed to load");
        const html = new DOMParser().parseFromString(await response.text(), "text/html");
        const content = html.querySelector(mode === "list" ? "[data-event-list-view]" : "[data-event-calendar-view]");
        if (!content) throw new Error("Missing pane");
        if (pending.signal.aborted || signal.aborted) return;
        pane.appendChild(content);
      }
      if (pending.signal.aborted || signal.aborted) return;
      history.replaceState(history.state, "", target);
      show(mode);
      if (mode === "list") {
        setupEventSearch();
        if (matchMedia("(hover: hover) and (pointer: fine)").matches) search.querySelector<HTMLInputElement>("[data-event-search-input]")?.focus({ preventScroll: true });
      } else {
        setupCalendar();
        shell.querySelector<HTMLAnchorElement>("[data-search-toggle]")?.focus({ preventScroll: true });
      }
      window.scrollTo({ top: mode === "list" ? searchScroll : calendarScroll, behavior: "instant" });
    } catch (cause) {
      if (pending.signal.aborted || signal.aborted) return;
      error.textContent = shell.dataset.error!; error.hidden = false;
    } finally { link.removeAttribute("aria-busy"); }
  }, { capture: true, signal });
  signal.addEventListener("abort", () => loading?.abort(), { once: true });
  setupCalendar(); setupEventSearch(); show(shell.dataset.mode!);
}
document.addEventListener("astro:page-load", setupShell);
setupShell();
