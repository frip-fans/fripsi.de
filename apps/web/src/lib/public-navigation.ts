// Astro owns document fetching, styles, scripts, history and traversal scrolling.
// This layer only remembers public browsing context and explicit return positions.
import { setupMusicBackLink } from "./music-navigation";

interface Visit { source: string | null; scroll: number; focusHref?: string }
const visits = new Map<string, Visit>();
let pending: { target: string; source: string | null; restore: boolean; traverse: boolean } | undefined;
let renderedUrl = location.href;
let renderedSource: string | null = history.state?.fripSource ?? null;
export function replacePublicUrl(url: URL) {
  history.replaceState(history.state, "", url);
  renderedUrl = url.href;
}
export const publicUrl = () => renderedUrl;
const remember = (focusHref?: string) => {
  visits.set(renderedUrl, { source: renderedSource, scroll: scrollY, focusHref });
  const shell = document.querySelector<HTMLElement>("[data-calendar-shell]");
  if (shell) {
    try { sessionStorage.setItem(`calendar:${shell.dataset.mode}`, renderedUrl); } catch { /* optional context */ }
  }
  if (visits.size > 40) visits.delete(visits.keys().next().value!);
};
const savedUrl = (key: string, path: string): URL | null => {
  try {
    const saved = sessionStorage.getItem(key);
    if (!saved) return null;
    const url = new URL(saved, location.origin);
    return url.origin === location.origin && url.pathname === path ? url : null;
  } catch { return null; }
};
function setupContext() {
  renderedUrl = location.href;
  renderedSource = history.state?.fripSource ?? null;
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (link.origin === location.origin && /^\/(admin|journey|discuss|yaginuma-intensity-calibrator)(?:\/|$)/.test(link.pathname)) link.setAttribute("data-astro-reload", "");
  }
  const locale = document.documentElement.lang;
  const assign = (link: HTMLAnchorElement, target: URL) => {
    if (target.searchParams.has("lang")) target.searchParams.set("lang", locale);
    link.href = target.href;
  };
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-music-tabs] a")) {
    const target = savedUrl(`music:list:${link.pathname.split("/")[2]}`, link.pathname);
    if (target && !link.classList.contains("active")) assign(link, target);
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-music-entry]")) {
    try {
      const path = localStorage.getItem("music:last-view") ?? "/music/lives";
      if (!/^\/music\/(lives|songs|releases)$/.test(path)) continue;
      assign(link, savedUrl(`music:list:${path.split("/")[2]}`, path) ?? new URL(path, location.origin));
    } catch { /* Ordinary links work without storage. */ }
  }
  const shell = document.querySelector<HTMLElement>("[data-calendar-shell]");
  if (shell) {
    const mode = shell.dataset.mode === "list" ? "list" : "calendar";
    try { sessionStorage.setItem(`calendar:${mode}`, location.href); } catch { /* optional context */ }
    const link = shell.querySelector<HTMLAnchorElement>(mode === "list" ? "[data-agenda-return]" : "[data-search-toggle]");
    const target = savedUrl(`calendar:${mode === "list" ? "calendar" : "list"}`, "/calendar");
    if (link && target) assign(link, target);
  }
  setupMusicBackLink();
}
document.addEventListener("astro:before-preparation", event => {
  const link = event.sourceElement?.closest("a");
  // popstate has already changed location; clicks still expose the outgoing URL.
  if (event.navigationType !== "traverse") renderedUrl = location.href;
  remember(link instanceof HTMLAnchorElement ? link.href : undefined);
  const returning = Boolean(link?.matches("[data-music-back], [data-event-return], [data-agenda-return], [data-search-toggle], [data-music-entry], [data-music-tabs] a"));
  const previous = visits.get(event.to.href);
  pending = {
    target: event.to.href,
    source: returning && previous ? previous.source : renderedUrl,
    restore: returning,
    traverse: event.navigationType === "traverse",
  };
});
document.addEventListener("astro:after-swap", () => {
  if (!pending || pending.target !== location.href) return;
  if (!pending.traverse) history.replaceState({ ...history.state, fripSource: pending.source }, "");
});
document.addEventListener("astro:page-load", () => {
  setupContext();
  const navigation = pending;
  pending = undefined;
  if (!navigation || navigation.target !== location.href || (!navigation.traverse && !navigation.restore)) return;
  const visit = visits.get(location.href);
  if (visit) requestAnimationFrame(() => {
    if (location.href !== navigation.target) return;
    if (!navigation.traverse) window.scrollTo({ top: visit.scroll, behavior: "instant" });
    const link = [...document.querySelectorAll<HTMLAnchorElement>("main a[href]")].find(link => link.href === visit.focusHref);
    link?.focus({ preventScroll: true });
  });
});
setupContext();
