/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { getOnThisDay, pickOnThisDay, type OnThisDayRow } from "./on-this-day";
import { createTestD1 } from "./test-d1";

const row = (start_date: string, category = "LIVE", setlist_id: string | null = null): OnThisDayRow =>
  ({ slug: `e-${start_date}`, title: `Event ${start_date}`, start_date, category, setlist_id });

describe("on this day", () => {
  it("prefers a show with a setlist, then a live, then the most recent year", () => {
    expect(pickOnThisDay([row("2024-11-09"), row("2011-11-09", "LIVE", "set")], "2026-11-09")?.event.start_date)
      .toBe("2011-11-09");
    expect(pickOnThisDay([row("2015-11-09", "EVENT"), row("2012-11-09", "LIVE")], "2026-11-09")?.event.start_date)
      .toBe("2012-11-09");
    expect(pickOnThisDay([row("2015-11-09", "EVENT"), row("2019-11-09", "EVENT")], "2026-11-09")?.event.start_date)
      .toBe("2019-11-09");
  });

  it("counts every match and the years since, and reports nothing for an empty day", () => {
    const picked = pickOnThisDay([row("2024-11-09"), row("2011-11-09"), row("2019-11-09")], "2026-11-09");
    expect(picked).toMatchObject({ years_ago: 2, total: 3 });
    expect(pickOnThisDay([], "2026-11-09")).toBeNull();
  });

  it("reads only published past events sharing the calendar day", async () => {
    const { db, sqlite } = createTestD1();
    try {
      const event = (id: string, date: string, published = 1, archived: string | null = null, category = "LIVE") =>
        sqlite.prepare("INSERT INTO events (id,slug,title,start_date,timezone,category,status,published,archived_at,created_at,updated_at) VALUES (?,?,?,?,'Asia/Tokyo',?,'completed',?,?,'now','now')")
          .run(id, `slug-${id}`, `Event ${id}`, date, category, published, archived);
      event("past", "2011-11-09");
      event("broadcast", "2019-11-09", 1, null, "EVENT");
      event("today", "2026-11-09");
      event("future", "2027-11-09");
      event("otherday", "2011-11-10");
      event("hidden", "2013-11-09", 0);
      event("archived", "2014-11-09", 1, "now");
      sqlite.exec("INSERT INTO setlists (id,event_id,performance_label,published,created_at,updated_at) VALUES ('set','past','Day 1',1,'now','now')");

      const result = await getOnThisDay(db, "2026-11-09");
      expect(result).toMatchObject({ years_ago: 15, total: 2 });
      expect(result?.event).toMatchObject({ slug: "slug-past", setlist_id: "set" });
      expect(await getOnThisDay(db, "2026-01-01")).toBeNull();
      expect(await getOnThisDay(db, "not-a-date")).toBeNull();
    } finally { sqlite.close(); }
  });
});
