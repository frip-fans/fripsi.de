import { describe, expect, it } from "vitest";
import { eventDraftSchema } from "./schema";
import { createEventSlug, dateInTimeZone, normalizeForDuplicate } from "./utils";

const baseEvent = {
  title: "fripSide LIVE 2026",
  start_date: "2026-08-31",
  timezone: "Asia/Tokyo",
  category: "LIVE" as const,
  status: "scheduled" as const,
  sources: [{ url: "https://fripside.net/news/1" }]
};

describe("event schema", () => {
  it("accepts a valid sourced event", () => {
    expect(eventDraftSchema.parse(baseEvent).title).toBe(baseEvent.title);
  });

  it("rejects an inverted range", () => {
    expect(() => eventDraftSchema.parse({ ...baseEvent, end_date: "2026-08-01" })).toThrow();
  });

  it("requires an HTTPS source", () => {
    expect(() => eventDraftSchema.parse({ ...baseEvent, sources: [{ url: "http://example.com" }] })).toThrow();
  });
});

describe("utilities", () => {
  it("creates stable readable slugs", () => {
    expect(createEventSlug("2026-08-31", "fripSide LIVE!", "evt_12345678")).toBe("2026-08-31-fripside-live");
  });

  it("falls back for Japanese-only titles", () => {
    expect(createEventSlug("2026-08-31", "ライブ", "evt_12345678")).toBe("2026-08-31-event-12345678");
  });

  it("normalizes duplicate titles", () => {
    expect(normalizeForDuplicate("fripSide LIVE！")).toBe(normalizeForDuplicate("fripside-live"));
  });

  it("formats Tokyo dates", () => {
    expect(dateInTimeZone(new Date("2026-07-18T16:00:00Z"))).toBe("2026-07-19");
  });
});
