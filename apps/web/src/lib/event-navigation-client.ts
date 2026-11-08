import { eventSourceContext, safeEventReturn } from "./event-navigation";
const pendingKey = "frip:event-entry";
const focusKey = "frip:event-return-focus";
interface Entry { destination: string; source: string; expires: number }
const read = (key: string): Entry | null => {
  try { return JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { return null; }
};
const write = (key: string, value: Entry) => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Links remain functional without storage. */ } };
const remove = (key: string) => { try { sessionStorage.removeItem(key); } catch { /* Storage can be unavailable. */ } };
let controller: AbortController | undefined;
function setupEventNavigation() {
  controller?.abort(); controller = new AbortController();
  const { signal } = controller;
  const detail = /^\/events\/[^/]+$/.test(location.pathname);
  const pending = read(pendingKey);
  // Consume once. A shared/direct link must not reuse an old tab's browsing history.
  if (detail && pending?.destination === location.href && pending.expires > Date.now()) {
    const context = safeEventReturn(new URL(location.href).searchParams.get("returnTo"));
    if (context?.href === pending.source && history.length > 1) {
      history.replaceState({ ...history.state, eventReturnSource: context.href }, "");
    }
    remove(pendingKey);
  }
  const updateLink = (target: EventTarget | null) => {
    if (!(target instanceof Element) || detail) return null;
    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (!link || link.origin !== location.origin || !/^\/events\/[^/]+$/.test(link.pathname)) return null;
    const context = eventSourceContext(new URL(location.href));
    if (!context) return null;
    const destination = new URL(link.href);
    destination.searchParams.set("returnTo", context.href);
    destination.searchParams.set("lang", document.documentElement.lang);
    link.href = destination.href;
    return { link, context };
  };
  // Keep modified clicks, context-menu opens and keyboard activation pointed at the latest query state.
  document.addEventListener("pointerdown", event => { updateLink(event.target); }, { capture: true, signal });
  document.addEventListener("focusin", event => { updateLink(event.target); }, { capture: true, signal });
  document.addEventListener("click", event => {
    const entry = updateLink(event.target);
    if (entry && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
      && (!entry.link.target || entry.link.target === "_self")) {
      write(pendingKey, { destination: entry.link.href, source: entry.context.href, expires: Date.now() + 60_000 });
    }
    if (!(event.target instanceof Element)) return;
    const back = event.target.closest<HTMLAnchorElement>("[data-event-return]");
    if (!back || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const context = safeEventReturn(new URL(location.href).searchParams.get("returnTo"));
    if (!context || back.pathname + back.search + back.hash !== context.href) return;
    write(focusKey, { destination: context.href, source: location.pathname, expires: Date.now() + 60_000 });
    if (history.state?.eventReturnSource === context.href && history.length > 1) {
      event.preventDefault(); history.back();
    }
  }, { capture: true, signal });
  const focus = read(focusKey);
  if (!detail && focus && focus.expires > Date.now()
    && eventSourceContext(new URL(location.href))?.href === focus.destination) {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (signal.aborted) return;
      remove(focusKey);
      const link = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
        .find(item => item.origin === location.origin && item.pathname === focus.source && item.getClientRects().length);
      link?.focus({ preventScroll: true });
    })));
  }
}
document.addEventListener("astro:page-load", setupEventNavigation);
window.addEventListener("pageshow", setupEventNavigation);
setupEventNavigation();
