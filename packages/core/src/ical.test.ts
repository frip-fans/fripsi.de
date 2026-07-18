import { describe, expect, it } from "vitest";
import { generateICalendar } from "./ical";
import type { EventRecord } from "./types";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "evt_123",
    slug: "2026-08-31-fripside-live",
    title: "fripSide LIVE 2026",
    start_date: "2026-08-31",
    end_date: null,
    start_time: null,
    end_time: null,
    timezone: "Asia/Tokyo",
    category: "LIVE",
    classification: null,
    venue: "Tokyo Garden Theater",
    region: "Tokyo",
    remark: null,
    status: "scheduled",
    published: true,
    version: 3,
    created_at: "2026-07-18T01:02:03Z",
    updated_at: "2026-07-19T04:05:06Z",
    published_at: "2026-07-19T04:05:06Z",
    archived_at: null,
    ...overrides
  };
}

describe("iCalendar feed", () => {
  it("writes an all-day event with an exclusive end date", () => {
    const calendar = generateICalendar([event()], { siteUrl: "https://fripsi.de" });
    expect(calendar).toContain("UID:evt_123@fripsi.de\r\n");
    expect(calendar).toContain("DTSTART;VALUE=DATE:20260831\r\n");
    expect(calendar).toContain("DTEND;VALUE=DATE:20260901\r\n");
    expect(calendar).toContain("SEQUENCE:3\r\n");
  });

  it("converts Tokyo event times to UTC", () => {
    const calendar = generateICalendar([event({ start_time: "18:00", end_time: "20:30" })], { siteUrl: "https://fripsi.de" });
    expect(calendar).toContain("DTSTART:20260831T090000Z\r\n");
    expect(calendar).toContain("DTEND:20260831T113000Z\r\n");
  });

  it("keeps cancelled and postponed events in the feed", () => {
    const calendar = generateICalendar([
      event({ id: "cancelled", status: "cancelled" }),
      event({ id: "postponed", status: "postponed" })
    ], { siteUrl: "https://fripsi.de" });
    expect(calendar).toContain("UID:cancelled@fripsi.de\r\n");
    expect(calendar).toContain("STATUS:CANCELLED\r\n");
    expect(calendar).toContain("UID:postponed@fripsi.de\r\n");
    expect(calendar).toContain("STATUS:TENTATIVE\r\n");
  });

  it("escapes text and folds every physical line to 75 octets", () => {
    const calendar = generateICalendar([event({
      title: "fripSide, very long fan event; with details",
      remark: "这是一个很长的活动说明，用来验证包含中文的 iCalendar 内容可以按照字节安全折行，而不会破坏 UTF-8 字符。"
    })], { siteUrl: "https://fripsi.de" });
    expect(calendar).toContain("SUMMARY:fripSide\\, very long fan event\\; with details");
    for (const line of calendar.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
