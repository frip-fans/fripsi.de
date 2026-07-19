import { describe, expect, it } from "vitest";
import { directEventSaveSchema, releaseSaveSchema, setlistSaveSchema } from "./content-admin";
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

describe("direct admin schemas", () => {
  it("accepts a direct unpublished event save", () => {
    const result = directEventSaveSchema.parse({
      published: false,
      idempotency_key: "event-save-1234",
      event: baseEvent,
    });
    expect(result.published).toBe(false);
  });

  it("rejects duplicate album track slots", () => {
    const track = {
      song_version_id: "version-1",
      disc_number: 1,
      track_number: 1,
      display_title: "Song",
    };
    expect(() => releaseSaveSchema.parse({
      idempotency_key: "release-save-1234",
      title: "Album",
      release_type: "album",
      published: true,
      sources: [],
      tracks: [track, track],
    })).toThrow(/重复/);
  });

  it("requires optimistic-lock values when editing music records", () => {
    expect(() => setlistSaveSchema.parse({
      id: "setlist-1",
      idempotency_key: "setlist-save-1234",
      event_id: "event-1",
      performance_label: "本公演",
      completeness: "complete",
      confidence: "official",
      published: true,
      sources: [],
      entries: [],
    })).toThrow(/并发校验值/);
  });
});
