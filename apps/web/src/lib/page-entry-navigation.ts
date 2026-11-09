import { cancelContentEntries, playContentEntry, playResultsEntry } from "./content-entry";

type EntryKind = "page" | "music" | "calendar" | "search" | "none";
export function navigationEntryKind(from: URL, to: URL, traversal = false): EntryKind {
  if (traversal || to.hash || (from.pathname === to.pathname && from.search === to.search)) return "none";
  const musicList = /^\/music\/(lives|songs|releases)\/?$/;
  if (musicList.test(from.pathname) && musicList.test(to.pathname)) return "music";
  if (from.pathname === "/calendar" && to.pathname === "/calendar") {
    const before = from.searchParams.get("view") === "list";
    const after = to.searchParams.get("view") === "list";
    if (before === after) return after ? "search" : "calendar";
  }
  return "page";
}

function playCalendarEntry(shell: HTMLElement) {
  let target: HTMLElement | null;
  if (window.matchMedia("(max-width: 800px)").matches) {
    target = shell.querySelector("[data-calendar-overview][open] [data-calendar-entry-grid]");
    if (!target) {
      const day = shell.querySelector<HTMLElement>(".mobile-timeline > .day-agenda");
      target = day && (day.querySelector(".stack")?.children.length ?? 0) > 6
        ? day.querySelector(".day-heading") : day;
    }
    target ??= shell.querySelector(".mobile-timeline .month-empty");
  } else target = shell.querySelector(".desktop-calendar [data-calendar-entry-grid]");
  playContentEntry(target);
}

let installed = false;
export function setupPageEntryTransitions() {
  if (installed || !document.querySelector('meta[name="astro-view-transitions-enabled"]')) return;
  installed = true;
  let pending: { kind: EntryKind; to: string; signal: AbortSignal } | undefined;
  let musicResults: HTMLElement | null = null;
  const clear = () => { pending = undefined; musicResults = null; cancelContentEntries(); };
  document.addEventListener("astro:before-preparation", event => {
    clear();
    const returning = event.sourceElement instanceof Element && event.sourceElement.closest("[data-music-back], [data-event-return], [data-agenda-return]");
    pending = {
      kind: returning ? "none" : navigationEntryKind(event.from, event.to, event.navigationType === "traverse"),
      to: event.to.href, signal: event.signal,
    };
  });
  document.addEventListener("astro:before-swap", event => {
    const fade = pending?.kind === "page" && !pending.signal.aborted;
    for (const root of [document.documentElement, event.newDocument.documentElement]) {
      root.toggleAttribute("data-page-transition", Boolean(fade));
    }
  });
  document.addEventListener("astro:after-swap", () => {
    const navigation = pending;
    pending = undefined;
    if (!navigation || navigation.signal.aborted || navigation.to !== location.href || navigation.kind === "none") return;
    // Full page changes use the layout shade; avoid a second opacity animation
    // on translucent panels and headings during that same transition.
    if (navigation.kind === "page") return;
    const music = document.querySelector<HTMLElement>("[data-music-browser]");
    const calendar = document.querySelector<HTMLElement>("[data-calendar-shell]");
    if (navigation.kind === "music") { musicResults = music?.querySelector("[data-music-results]") ?? null; return; }
    if (navigation.kind === "calendar" && calendar) { playCalendarEntry(calendar); return; }
    if (navigation.kind === "search") { playResultsEntry(document.querySelector("[data-search-results]")); return; }

  });
  document.addEventListener("astro:page-load", () => {
    const target = musicResults;
    musicResults = null;
    // Responsive release batches may start an API refresh during setup. Let that
    // response animate its new results instead of animating the temporary SSR batch.
    if (target?.isConnected && target.getAttribute("aria-busy") !== "true") playResultsEntry(target);
  });
  window.addEventListener("pagehide", clear);
  window.addEventListener("pageshow", event => { if (event.persisted) clear(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelContentEntries(); });
}
