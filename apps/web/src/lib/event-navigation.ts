export type EventReturnKind = "home" | "calendar" | "search";
const base = "https://fripsi.de";
/** Only public browsing contexts are valid return targets, never arbitrary URLs. */
export function eventSourceContext(source: URL): { href: string; kind: EventReturnKind } | null {
  const url = new URL(source.pathname + source.search + source.hash, base);
  if (["/api/events", "/api/event-search", "/archive"].includes(url.pathname)) {
    url.pathname = "/calendar"; url.searchParams.set("view", "list");
  }
  if (url.pathname === "/api/calendar-month") url.pathname = "/calendar";
  if (!["/", "/calendar"].includes(url.pathname)) return null;
  url.searchParams.delete("after");
  url.searchParams.delete("returnTo");
  return { href: url.pathname + url.search + url.hash,
    kind: url.pathname === "/" ? "home" : url.searchParams.get("view") === "list" ? "search" : "calendar" };
}
export function safeEventReturn(raw: string | null) {
  if (!raw || raw.length > 2048 || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  try {
    const url = new URL(raw, base);
    if (url.origin !== base || !["/", "/calendar", "/archive"].includes(url.pathname)) return null;
    return eventSourceContext(url);
  } catch { return null; }
}
export function eventDetailHref(slug: string, source: URL, locale: string): string {
  const params = new URLSearchParams({ lang: locale });
  const context = eventSourceContext(source);
  if (context) params.set("returnTo", context.href);
  return `/events/${encodeURIComponent(slug)}?${params}`;
}
export function eventReturnLink(url: URL, eventMonth: string, locale: string) {
  const context = safeEventReturn(url.searchParams.get("returnTo"));
  if (context) return { ...context, label: `event.return.${context.kind}` as const };
  const params = new URLSearchParams({ month: eventMonth, lang: locale });
  return { href: `/calendar?${params}`, kind: "calendar" as const, label: "event.viewCalendar" as const };
}
