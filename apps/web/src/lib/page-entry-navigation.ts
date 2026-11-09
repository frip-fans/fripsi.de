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

// The shade exists to cover the wait for the next document, so it only starts
// once a navigation is already slower than this. Quicker ones have nothing to
// cover and stay instant rather than paying for an animation of their own.
const SHADE_DELAY_MS = 120;

interface Shade { signal: AbortSignal; timer?: ReturnType<typeof setTimeout>; dimmed: boolean }

let installed = false;
export function setupPageEntryTransitions() {
  if (installed || !document.querySelector('meta[name="astro-view-transitions-enabled"]')) return;
  installed = true;
  let pending: { kind: EntryKind; to: string; signal: AbortSignal } | undefined;
  let musicResults: HTMLElement | null = null;
  let shade: Shade | undefined;
  let reducedMotion: MediaQueryList | undefined;

  // Hand the reveal the opacity the dim actually reached so a document that
  // arrives mid-dim fades out from there instead of darkening first. One style
  // read on content that is about to be replaced; never a layout read.
  const revealShade = (root: HTMLElement) => {
    const main = document.querySelector("main");
    const reached = main ? window.getComputedStyle(main, "::after").opacity : "";
    if (Number(reached) > 0) root.style.setProperty("--page-shade-from", reached);
    else root.style.removeProperty("--page-shade-from");
    root.dataset.pageShade = "reveal";
  };
  const stopShade = (reveal = false) => {
    const current = shade;
    shade = undefined;
    clearTimeout(current?.timer);
    const root = document.documentElement;
    if (!root) return;
    if (current?.dimmed && reveal) revealShade(root);
    else delete root.dataset.pageShade;
  };
  const startShade = (signal: AbortSignal) => {
    reducedMotion ??= window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches || document.hidden) return;
    const current: Shade = shade = { signal, dimmed: false };
    current.timer = setTimeout(() => {
      current.timer = undefined;
      if (shade !== current || signal.aborted) return;
      current.dimmed = true;
      document.documentElement.dataset.pageShade = "dim";
    }, SHADE_DELAY_MS);
    // An abandoned navigation keeps its own document, so fade the dim back out.
    signal.addEventListener("abort", () => { if (shade === current) stopShade(true); }, { once: true });
  };

  const clear = () => { pending = undefined; musicResults = null; cancelContentEntries(); stopShade(); };
  document.addEventListener("astro:before-preparation", event => {
    clear();
    const returning = event.sourceElement instanceof Element && event.sourceElement.closest("[data-music-back], [data-event-return], [data-agenda-return]");
    pending = {
      kind: returning ? "none" : navigationEntryKind(event.from, event.to, event.navigationType === "traverse"),
      to: event.to.href, signal: event.signal,
    };
    if (pending.kind === "page") startShade(event.signal);
  });
  document.addEventListener("astro:before-swap", event => {
    if (!shade?.dimmed || shade.signal.aborted) { stopShade(); return; }
    // Astro replaces every root attribute with the incoming document's, so the
    // shade has to be handed over there to outlast the swap it is covering.
    revealShade(event.newDocument.documentElement);
    shade = undefined;
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
