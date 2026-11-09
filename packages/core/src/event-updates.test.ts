/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { eventUpdateWindowStart, listEventUpdates, summarizeEventUpdates, type EventAuditRow } from "./event-updates";
import { createTestD1 } from "./test-d1";

const row = (target_id: string, created_at: string, before: Record<string, unknown>, after: Record<string, unknown>, action = "event.update"): EventAuditRow =>
  ({ target_id, action, created_at, before_json: JSON.stringify(before), after_json: JSON.stringify(after) });

const base = { status: "scheduled", start_date: "2026-11-21", start_time: "17:00", venue: "横浜アリーナ", region: "神奈川県", title: "Show" };

describe("event update highlights", () => {
  it("keeps the most significant change and dates it by the newest edit that made it", () => {
    const result = summarizeEventUpdates([
      row("a", "2026-11-01T00:00:00Z", base, { ...base, start_time: "18:00" }),
      row("a", "2026-11-05T00:00:00Z", base, { ...base, title: "Show (renamed)" }),
      row("b", "2026-11-02T00:00:00Z", base, { ...base, venue: "幕張メッセ" }),
      row("b", "2026-11-06T00:00:00Z", base, { ...base, status: "postponed" }),
    ]);
    // A later typo fix must not hide the earlier time change.
    expect(result.get("a")).toMatchObject({ kind: "time", changed_at: "2026-11-01T00:00:00Z" });
    expect(result.get("b")).toMatchObject({ kind: "status", changed_at: "2026-11-06T00:00:00Z" });
  });

  it("ignores rows with no watched field change and unparseable rows", () => {
    const result = summarizeEventUpdates([
      row("a", "2026-11-01T00:00:00Z", base, { ...base, updated_at: "later" }),
      { target_id: "b", action: "event.update", created_at: "2026-11-01T00:00:00Z", before_json: "{", after_json: "{" },
      { target_id: "c", action: "event.update", created_at: "2026-11-01T00:00:00Z", before_json: null, after_json: JSON.stringify(base) },
    ]);
    expect(result.size).toBe(0);
  });

  it("reads edits from the audit log but never bulk imports", async () => {
    const { db, sqlite } = createTestD1();
    try {
      const insert = (id: string, action: string, target: string, created: string, after: Record<string, unknown>) =>
        sqlite.prepare("INSERT INTO audit_logs (id,actor_id,actor_type,channel,action,target_type,target_id,request_id,before_json,after_json,created_at) VALUES (?,?,'human','admin',?,'event',?,?,?,?,?)")
          .run(id, "actor", action, target, `req-${id}`, JSON.stringify(base), JSON.stringify(after), created);
      insert("a1", "event.update", "evt-a", "2026-11-05T00:00:00Z", { ...base, venue: "幕張メッセ" });
      insert("a2", "event.import", "evt-a", "2026-11-08T00:00:00Z", { ...base, status: "cancelled" });
      insert("b1", "event.update", "evt-b", "2026-09-01T00:00:00Z", { ...base, status: "cancelled" });
      insert("c1", "change.publish_status_change", "evt-c", "2026-11-07T00:00:00Z", { ...base, status: "postponed" });
      insert("d1", "event.create", "evt-d", "2026-11-03T00:00:00Z", base);
      insert("d2", "event.update", "evt-d", "2026-11-04T00:00:00Z", { ...base, venue: "日本武道館" });

      const since = eventUpdateWindowStart("2026-11-09");
      const result = await listEventUpdates(db, ["evt-a", "evt-b", "evt-c", "evt-d", "evt-missing"], since);
      // The import is skipped, so evt-a keeps the venue edit rather than the import's status rewrite.
      expect(result.get("evt-a")).toMatchObject({ kind: "venue" });
      // evt-b changed before the window starts.
      expect(result.has("evt-b")).toBe(false);
      expect(result.get("evt-c")).toMatchObject({ kind: "status" });
      // A brand new event stays "just announced" even though it was edited afterwards.
      expect(result.get("evt-d")).toMatchObject({ kind: "new", changed_at: "2026-11-03T00:00:00Z" });
      expect(await listEventUpdates(db, [], since)).toEqual(new Map());
    } finally { sqlite.close(); }
  });

  it("starts the window the configured number of days before the day given", () => {
    expect(eventUpdateWindowStart("2026-11-09", 30)).toBe("2026-10-10T00:00:00.000Z");
    expect(eventUpdateWindowStart("2026-11-09", 0)).toBe("2026-11-09T00:00:00.000Z");
  });
});
