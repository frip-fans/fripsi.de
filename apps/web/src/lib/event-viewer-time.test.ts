import { describe, expect, it } from "vitest";
import { viewerTime } from "./event-viewer-time";

const evening = { start: "2026-08-31T09:00:00.000Z", end: "2026-08-31T11:30:00.000Z", date: "2026-08-31", time: "18:00" };

describe("viewerTime", () => {
  it("adds nothing when the viewer shares the event's clock", () => {
    expect(viewerTime(evening, "Asia/Tokyo")).toBeNull();
    expect(viewerTime(evening, "Asia/Seoul")).toBeNull();
  });

  it("converts the range to the viewer's zone", () => {
    expect(viewerTime(evening, "Asia/Shanghai")).toEqual({ time: "17:00–19:30", dayShift: 0 });
    expect(viewerTime({ ...evening, end: null }, "Europe/London")).toEqual({ time: "10:00", dayShift: 0 });
  });

  it("marks a start that lands on the neighbouring day", () => {
    const midnight = { start: "2026-11-21T15:30:00.000Z", date: "2026-11-22", time: "00:30" };
    expect(viewerTime(midnight, "Asia/Shanghai")).toEqual({ time: "23:30", dayShift: -1 });
    const morning = { start: "2026-11-21T23:00:00.000Z", date: "2026-11-21", time: "18:00" };
    expect(viewerTime(morning, "Asia/Tokyo")).toEqual({ time: "08:00", dayShift: 1 });
  });

  it("ignores an unreadable start", () => {
    expect(viewerTime({ ...evening, start: "" }, "Asia/Shanghai")).toBeNull();
  });
});
