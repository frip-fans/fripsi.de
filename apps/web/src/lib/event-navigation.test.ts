import { describe, expect, it } from "vitest";
import { eventDetailHref, eventReturnLink, safeEventReturn } from "./event-navigation";
const base = "https://fripsi.de";
describe("event detail return context", () => {
  it.each([
    ["/?lang=en", "home"],
    ["/calendar?month=2024-06&category=LIVE&lang=ja#agenda-2024-06-15", "calendar"],
    ["/calendar?view=list&q=Tokyo&category=LIVE&category=EVENT&location=jp%3Aarea_jp_13&sort=asc&lang=en", "search"],
  ])("preserves the full %s browsing context", (source, kind) => {
    const href = eventDetailHref("test-event", new URL(source, base), "en");
    const destination = new URL(href, base);
    const back = eventReturnLink(destination, "2020-01", "en");
    expect(back.href).toBe(source);
    expect(back.label).toBe(`event.return.${kind}`);
    expect(destination.searchParams.get("lang")).toBe("en");
  });
  it("uses search context for dynamically loaded cards without exposing the fragment endpoint/cursor", () => {
    const href = eventDetailHref("test-event", new URL("/api/events?view=list&q=Tokyo&year=2019&after=cursor", base), "ja");
    const back = eventReturnLink(new URL(href, base), "2020-01", "ja");
    expect(back.href).toBe("/calendar?view=list&q=Tokyo&year=2019");
    expect(back.kind).toBe("search");
  });
  it.each([null, "https://evil.example/", "//evil.example/", "/\\evil.example/", "/admin", "/calendar/../admin", "/api/admin/export.csv", "javascript:alert(1)"])("rejects unsafe or unrelated return targets: %s", raw => {
    expect(safeEventReturn(raw)).toBeNull();
    const url = new URL("/events/test-event", base);
    if (raw) url.searchParams.set("returnTo", raw);
    expect(eventReturnLink(url, "2020-01", "ja")).toEqual({
      href: "/calendar?month=2020-01&lang=ja", kind: "calendar", label: "event.viewCalendar",
    });
  });
  it("retains legacy archive links as search links and removes nested return contexts", () => {
    expect(safeEventReturn("/archive?year=2018&returnTo=%2Fadmin")).toEqual({ href: "/calendar?year=2018&view=list", kind: "search" });
  });
});
