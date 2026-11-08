import { afterEach, describe, expect, it } from "vitest";
import { createTestD1 } from "./test-d1";
import { countPublicEventSearch, getPublicEventFilters, listPublicEventSearch, parsePublicEventSearch } from "./public-event-search";

const stores: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.sqlite.close(); });
function fixture() {
  const store = createTestD1(); stores.push(store);
  const insert = store.sqlite.prepare(`INSERT INTO events
    (id, slug, title, start_date, start_time, category, published, archived_at, created_at, updated_at, location_note, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)`);
  for (let i = 0; i < 67; i++) {
    const id = `evt_${String(i).padStart(3, "0")}`;
    insert.run(id, id, i === 0 ? "100%_special" : "fripSide Live", i < 33 ? "2020-06-01" : "2026-11-01",
      i % 3 ? "18:00" : null, i % 2 ? "LIVE" : "MEDIA", 1, null, null, null);
  }
  insert.run("hidden", "hidden", "fripSide Live", "2026-11-01", null, "LIVE", 0, null, null, null);
  insert.run("archived", "archived", "fripSide Live", "2026-11-01", null, "LIVE", 1, "2026-11-02", null, null);
  store.sqlite.exec(`INSERT INTO administrative_areas(id, country_code, level, parent_id, name_local, name_en)
    VALUES ('test_ward', 'JP', 'ward', 'area_jp_13', '架空区', 'Test Ward');
    INSERT INTO venues(id, canonical_name, administrative_area_id, created_at, updated_at)
    VALUES ('v_test', 'Test Tokyo Hall', 'test_ward', '', '');
    INSERT INTO event_venues(event_id, venue_id, role, position) VALUES ('evt_001', 'v_test', 'primary', 1);
    INSERT INTO event_channels(id, event_id, channel_type, name, position)
    VALUES ('ch_test', 'evt_002', 'streaming', 'Test Stream', 1);`);
  return store;
}
const input = (query = "") => parsePublicEventSearch(new URLSearchParams(query));

describe("public event discovery", () => {
  it("searches across years by default and restricts the complete result set only when requested", async () => {
    const { db } = fixture();
    expect(await countPublicEventSearch(db, input())).toBe(67);
    expect(await countPublicEventSearch(db, input("year=2020"))).toBe(33);
    expect(await countPublicEventSearch(db, input("q=fripside+live&category=LIVE&year=2020"))).toBe(16);
    const page = await listPublicEventSearch(db, input());
    expect(page.events).toHaveLength(30);
    expect(page.events.every(event => event.start_date === "2026-11-01")).toBe(true);
    expect(page.events.some(event => ["hidden", "archived"].includes(event.id))).toBe(false);
  });
  it.each(["asc", "desc"])("paginates tied dates/times without duplicates or omissions (%s)", async sort => {
    const { db } = fixture();
    const query = input(`sort=${sort}`);
    const ids: string[] = [];
    do {
      const page = await listPublicEventSearch(db, query);
      ids.push(...page.events.map(event => event.id));
      query.after = page.nextCursor;
    } while (query.after);
    expect(ids).toHaveLength(67);
    expect(new Set(ids).size).toBe(67);
  });
  it("matches terms across title, localized location and channel fields, treating wildcard characters literally", async () => {
    const { db } = fixture();
    expect(await countPublicEventSearch(db, input("q=fripside+Tokyo"))).toBe(1);
    expect(await countPublicEventSearch(db, input("q=Test+Ward"))).toBe(1);
    expect(await countPublicEventSearch(db, input("q=Test+Stream"))).toBe(1);
    expect(await countPublicEventSearch(db, input(`q=${encodeURIComponent("100%_")}`))).toBe(1);
    expect(await countPublicEventSearch(db, input(`q=${encodeURIComponent("' OR 1=1 --")}`))).toBe(0);
  });
  it("uses prefecture ancestry for filtering and counts each event once per location", async () => {
    const { db, sqlite } = fixture();
    sqlite.exec(`INSERT INTO venues(id, canonical_name, administrative_area_id, created_at, updated_at)
      VALUES ('v_second', 'Other Hall', 'area_jp_13', '', '');
      INSERT INTO event_venues(event_id, venue_id, role, position) VALUES ('evt_001', 'v_second', 'secondary', 2);`);
    expect(await countPublicEventSearch(db, input("location=jp:area_jp_13"))).toBe(1);
    const page = await listPublicEventSearch(db, input("location=jp:area_jp_13&category=LIVE"));
    expect(page.events.map(event => event.id)).toEqual(["evt_001"]);
    const filters = await getPublicEventFilters(db);
    expect(filters.locations.find(item => item.key === "jp:area_jp_13")?.count).toBe(1);
    expect(filters.years).toEqual([{ year: "2026", count: 34 }, { year: "2020", count: 33 }]);
  });
  it("ignores malformed cursors and bounds/canonicalizes public inputs", () => {
    const parsed = input("q=" + "a".repeat(500) + "&year=nope&category=LIVE&category=LIVE&category=wrong&after=nope&location=country:SG&location=bad");
    expect(parsed.query).toHaveLength(200);
    expect(parsed.year).toBe(""); expect(parsed.after).toBe("");
    expect(parsed.categories).toEqual(["LIVE"]); expect(parsed.locations).toEqual(["country:SG"]);
  });
});
