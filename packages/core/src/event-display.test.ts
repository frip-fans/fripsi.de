/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { ContentAdminService } from "./content-admin";
import { eventDisplayTitle } from "./event-display";
import { getEventById } from "./repository";
import { createTestD1 } from "./test-d1";
import { getPublicTourBySlug, getTourById, listTours } from "./tours";
import type { Actor } from "./types";

const actor: Actor = { id: "editor@example.com", type: "human", channel: "admin", scopes: ["events:publish"] };

function seed(sqlite: import("node:sqlite").DatabaseSync) {
  sqlite.exec(`
    INSERT INTO administrative_areas (id, country_code, level, name_local) VALUES
      ('tokyo', 'JP', 'subdivision', '東京都'), ('hokkaido', 'JP', 'subdivision', '北海道');
    INSERT INTO venues (id, canonical_name, administrative_area_id, status, created_at, updated_at) VALUES
      ('v1', 'Hall A', 'tokyo', 'active', 'now', 'now'), ('v2', 'Hall B', 'hokkaido', 'active', 'now', 'now');
    INSERT INTO tours (id, slug, name, published, created_at, updated_at) VALUES
      ('t1', 'liberation', 'Liberation Protocol', 1, 'now', 'now'), ('t2', 'hidden', 'Hidden Tour', 0, 'now', 'now');
  `);
  const events: Array<[string, string, string | null, string | null, string | null]> = [
    ["e-alias", "「Official A」@東京・Hall A", "Custom name", "t1", null],
    ["e-derived", "「Official B」@東京・Hall A", null, "t1", null],
    ["e-stop", "「Official C」@札幌・Hall B", null, "t1", "札幌 DAY2"],
    ["e-hokkaido", "「Official D」@札幌・Hall B", null, "t1", null],
    ["e-hidden", "「Official E」@東京・Hall A", null, "t2", null],
    ["e-plain", "「Official F」", null, null, null],
  ];
  events.forEach(([id, title, alias, tour, stop], index) => {
    sqlite.prepare(`INSERT INTO events (id, slug, title, start_date, timezone, category, location_mode, status, published, version, created_at, updated_at, alias, tour_id, tour_stop)
      VALUES (?, ?, ?, ?, 'Asia/Tokyo', 'LIVE', 'physical', 'completed', 1, 1, 'now', 'now', ?, ?, ?)`).run(id, id, title, `2026-01-0${index + 1}`, alias, tour, stop);
  });
  for (const [event, venue] of [["e-alias", "v1"], ["e-derived", "v1"], ["e-stop", "v2"], ["e-hokkaido", "v2"], ["e-hidden", "v1"]]) {
    sqlite.prepare("INSERT INTO event_venues (event_id, venue_id, role, position) VALUES (?, ?, 'primary', 1)").run(event, venue);
  }
}

describe("event display names", () => {
  it("prefers the alias, then tour · stop (derived from the venue area), then the official title", async () => {
    const { db, sqlite } = createTestD1();
    try {
      seed(sqlite);
      const name = async (id: string) => (await getEventById(db, id, false))?.display_title;
      expect(await name("e-alias")).toBe("Custom name");
      expect(await name("e-derived")).toBe("Liberation Protocol · 東京公演");
      expect(await name("e-stop")).toBe("Liberation Protocol · 札幌 DAY2");
      expect(await name("e-hokkaido")).toBe("Liberation Protocol · 北海道公演");
      expect(await name("e-hidden")).toBe("「Official E」@東京・Hall A");
      expect(await name("e-plain")).toBe("「Official F」");
      expect((await getEventById(db, "e-derived", false))?.tour).toEqual({ id: "t1", slug: "liberation", name: "Liberation Protocol" });
    } finally { sqlite.close(); }
  });

  it("mirrors the rule in TypeScript", () => {
    expect(eventDisplayTitle({ title: "T", alias: " A " })).toBe("A");
    expect(eventDisplayTitle({ title: "T", tour_name: "Tour", stop_area: "東京" })).toBe("Tour · 東京公演");
    expect(eventDisplayTitle({ title: "T", tour_name: "Tour" })).toBe("T");
  });

  it("lists tours with their stops and hides unpublished tours and events from the public view", async () => {
    const { db, sqlite } = createTestD1();
    try {
      seed(sqlite);
      sqlite.exec("UPDATE events SET published = 0 WHERE id = 'e-hokkaido'");
      const all = await listTours(db);
      // Newest first: the hidden tour's only stop is later than the first Liberation stop.
      expect(all.map(tour => [tour.slug, tour.stop_count])).toEqual([["hidden", 1], ["liberation", 4]]);
      expect((await listTours(db, { publicOnly: true })).map(tour => [tour.slug, tour.stop_count])).toEqual([["liberation", 3]]);
      const detail = await getPublicTourBySlug(db, "liberation");
      expect(detail?.stops.map(stop => stop.display_title)).toEqual(["Custom name", "Liberation Protocol · 東京公演", "Liberation Protocol · 札幌 DAY2"]);
      expect(await getPublicTourBySlug(db, "hidden")).toBeNull();
    } finally { sqlite.close(); }
  });

  it("saves tours and event display fields from the admin, keeping them when a save omits them", async () => {
    const { db, sqlite } = createTestD1();
    try {
      const service = new ContentAdminService(db);
      const tour = await service.saveTour({ name: "Liberation Protocol", published: true, idempotency_key: "tour-create-1" }, actor);
      expect(tour.slug).toBe("liberation-protocol");
      const renamed = await service.saveTour({ id: tour.id, expected_updated_at: tour.updated_at, name: "Liberation", published: true, idempotency_key: "tour-rename-1" }, actor);
      expect(renamed.name).toBe("Liberation");
      await expect(service.saveTour({ id: tour.id, expected_updated_at: tour.updated_at, name: "Stale", published: true, idempotency_key: "tour-stale-1" }, actor)).rejects.toThrow("已经被修改");

      const draft = {
        title: "「Official」@東京・Hall", start_date: "2026-01-04", category: "LIVE", location_mode: "online",
        channels: [{ channel_type: "streaming", name: "Stream" }], status: "scheduled",
        sources: [{ url: "https://fripside.net/news/1" }],
      };
      const created = await service.saveEvent({ published: true, idempotency_key: "event-create-1", event: draft,
        display: { alias: "", tour_id: tour.id, tour_stop: "東京公演" } }, actor);
      expect(created.display_title).toBe("Liberation · 東京公演");
      const kept = await service.saveEvent({ id: created.id, expected_version: created.version, published: true, idempotency_key: "event-keep-1", event: draft }, actor);
      expect([kept.tour_id, kept.tour_stop]).toEqual([tour.id, "東京公演"]);
      const aliased = await service.saveEvent({ id: created.id, expected_version: kept.version, published: true, idempotency_key: "event-alias-1", event: draft,
        display: { alias: "Liberation Protocol · 東京公演", tour_id: null, tour_stop: null } }, actor);
      expect([aliased.display_title, aliased.tour_id]).toEqual(["Liberation Protocol · 東京公演", null]);
      await expect(service.saveEvent({ published: true, idempotency_key: "event-badtour-1", event: draft, display: { tour_id: "nope" } }, actor)).rejects.toThrow("巡演不存在");
      expect((await getTourById(db, tour.id))?.stops).toEqual([]);
    } finally { sqlite.close(); }
  });
});
