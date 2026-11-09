import { describe, expect, it } from "vitest";
import { displayEventStatus, eventDisplayTitle } from "./format";

describe("displayEventStatus", () => {
  it("automatically completes a scheduled event after its last date", () => {
    expect(displayEventStatus({
      start_date: "2026-08-15",
      end_date: null,
      status: "scheduled"
    }, "2026-08-18")).toBe("completed");
  });

  it("keeps today's and future scheduled events scheduled", () => {
    expect(displayEventStatus({
      start_date: "2026-08-18",
      end_date: null,
      status: "scheduled"
    }, "2026-08-18")).toBe("scheduled");
    expect(displayEventStatus({
      start_date: "2026-08-20",
      end_date: null,
      status: "scheduled"
    }, "2026-08-18")).toBe("scheduled");
  });

  it("waits until a multi-day event's end date has passed", () => {
    expect(displayEventStatus({
      start_date: "2026-08-17",
      end_date: "2026-08-19",
      status: "scheduled"
    }, "2026-08-18")).toBe("scheduled");
  });

  it.each(["completed", "cancelled", "postponed"] as const)("preserves an explicit %s status", (status) => {
    expect(displayEventStatus({
      start_date: "2026-08-15",
      end_date: null,
      status
    }, "2026-08-18")).toBe(status);
  });
});

describe("eventDisplayTitle", () => {
  it("drops the venue tail and the outer brackets when the venue is shown separately", () => {
    expect(eventDisplayTitle("「Anime Festival Asia Singapore 2012 I LOVE ANISONG」@Singapore・Singapore Expo Max Pavilion", true))
      .toBe("Anime Festival Asia Singapore 2012 I LOVE ANISONG");
  });

  it("keeps the venue tail when no location is shown", () => {
    expect(eventDisplayTitle("「京 Premium Live 2024」@京都・ロームシアター京都", false)).toBe("「京 Premium Live 2024」@京都・ロームシアター京都");
  });

  it("keeps brackets that do not wrap the whole title", () => {
    expect(eventDisplayTitle("【STORE】「アニメイトfripSide「double Decades」発売記念イベント」@東京・アニメイト池袋", true))
      .toBe("【STORE】「アニメイトfripSide「double Decades」発売記念イベント」");
    expect(eventDisplayTitle("「A」と「B」", true)).toBe("「A」と「B」");
  });

  it("unwraps nested brackets when the outer pair spans the title", () => {
    expect(eventDisplayTitle("「アニメイトfripSide「double Decades」発売記念イベント」", true)).toBe("アニメイトfripSide「double Decades」発売記念イベント");
  });
});
