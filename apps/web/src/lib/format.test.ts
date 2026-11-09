import { describe, expect, it } from "vitest";
import { displayEventStatus } from "./format";

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
