import { describe, expect, it } from "vitest";
import { archiveRedirectHref, calendarViewHref, eventListYear } from "./calendar-navigation";

describe("unified event calendar navigation", () => {
  it("preserves legacy search, repeated filters, year, language and anchor", () => {
    const source = new URL("https://fripsi.de/archive?year=2025&q=Tokyo&category=LIVE&category=EVENT&location=jp%3Aarea_jp_13&lang=en#archive-current-time");
    const target = new URL(archiveRedirectHref(source), source);
    expect(target.pathname).toBe("/calendar");
    expect(target.searchParams.get("view")).toBe("list");
    expect(target.searchParams.get("year")).toBe("2025");
    expect(target.searchParams.get("q")).toBe("Tokyo");
    expect(target.searchParams.getAll("category")).toEqual(["LIVE", "EVENT"]);
    expect(target.searchParams.get("location")).toBe("jp:area_jp_13");
    expect(target.searchParams.get("lang")).toBe("en");
    expect(target.hash).toBe("#archive-current-time");
  });

  it("opens the selected month in the matching list year", () => {
    const target = new URL(calendarViewHref(new URLSearchParams("month=2024-06&category=LIVE"), "list", "2026-11"), "https://fripsi.de");
    expect(target.searchParams.get("year")).toBe("2024");
    expect(target.searchParams.get("month")).toBe("2024-06");
    expect(target.searchParams.get("category")).toBe("LIVE");
  });

  it("uses the list year without losing month, search, sort or filters", () => {
    const params = new URLSearchParams("view=list&year=2023&month=2025-08&q=festival&sort=desc&category=LIVE&category=EVENT&location=country%3ASG");
    const target = new URL(calendarViewHref(params, "calendar", "2026-11"), "https://fripsi.de");
    expect(target.searchParams.get("month")).toBe("2023-08");
    expect(target.searchParams.get("q")).toBe("festival");
    expect(target.searchParams.get("sort")).toBe("desc");
    expect(target.searchParams.getAll("category")).toEqual(["LIVE", "EVENT"]);
    expect(target.searchParams.get("location")).toBe("country:SG");
    expect(params.get("month")).toBe("2025-08");
  });

  it("uses the current month when switching from a list without a selected month", () => {
    const target = new URL(calendarViewHref(new URLSearchParams("view=list&year=2022"), "calendar", "2026-11"), "https://fripsi.de");
    expect(target.searchParams.get("month")).toBe("2022-11");
  });
  it("updates an old list year when switching after navigating to another calendar year", () => {
    const target = new URL(calendarViewHref(new URLSearchParams("view=calendar&year=2023&month=2025-06&q=live"), "list", "2026-11"), "https://fripsi.de");
    expect(target.searchParams.get("year")).toBe("2025");
    expect(target.searchParams.get("q")).toBe("live");
  });

  it("keeps the selected list year when filters find matches only in another year", () => {
    expect(eventListYear("2025", "2026", [{ year: "2026" }])).toBe("2025");
    expect(eventListYear("2024", "2026", [])).toBe("2024");
    expect(eventListYear("bad", "2026", [{ year: "2023" }])).toBe("2023");
    expect(eventListYear("9999", "2026", [])).toBe("2026");
  });

});
