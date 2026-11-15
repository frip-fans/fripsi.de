/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ContentAdminService } from "./content-admin";
import { ChangeService } from "./change-service";
import type { Actor } from "./types";

class TestStatement {
  private bindings: unknown[] = [];
  constructor(private readonly statement: StatementSync) {}
  bind(...values: unknown[]): D1PreparedStatement { this.bindings = values; return this as unknown as D1PreparedStatement; }
  async all<T>(): Promise<D1Result<T>> {
    return { success: true, results: this.statement.all(...sqlValues(this.bindings)) as T[], meta: {} } as D1Result<T>;
  }
  async first<T>(): Promise<T | null> {
    return (this.statement.get(...sqlValues(this.bindings)) as T | undefined) ?? null;
  }
  execute(): D1Result {
    const result = this.statement.run(...sqlValues(this.bindings));
    return { success: true, results: [], meta: { changes: Number(result.changes) } } as unknown as D1Result;
  }
}

function sqlValues(values: unknown[]): SQLInputValue[] {
  return values.map((value) => {
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value == null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array) return value;
    throw new TypeError(`Unsupported SQL binding: ${typeof value}`);
  });
}

class TestD1 {
  constructor(readonly sqlite: DatabaseSync) {}
  prepare(sql: string): D1PreparedStatement {
    return new TestStatement(this.sqlite.prepare(sql)) as unknown as D1PreparedStatement;
  }
  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    return statements.map((statement) => (statement as unknown as TestStatement).execute());
  }
}

function migration(name: string): string {
  return readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), "utf8");
}

describe("content admin structured locations", () => {
  it("creates an event, canonical venue, relation, and hydrated location label", async () => {
    const sqlite = new DatabaseSync(":memory:");
    for (const name of ["0001_initial.sql", "0002_import_jobs.sql", "0003_music_library.sql", "0004_structured_locations.sql", "0005_journey_coordinates.sql", "0006_journey_coordinate_data.sql", "0016_event_alias_tours.sql", "0018_admin_chat.sql", "0019_admin_chat_history.sql"]) {
      sqlite.exec(migration(name));
    }
    const db = new TestD1(sqlite) as unknown as D1Database;
    const actor: Actor = { id: "tester", type: "human", channel: "admin", scopes: ["events:publish"] };
    const event = await new ContentAdminService(db).saveEvent({
      published: true,
      idempotency_key: "structured-location-save",
      event: {
        title: "Structured venue test",
        start_date: "2026-08-23",
        timezone: "Asia/Tokyo",
        category: "LIVE",
        status: "scheduled",
        location_mode: "physical",
        location_note: null,
        venues: [{
          canonical_name: "新宿LOFT",
          administrative_area_id: "area_jp_13104",
          role: "primary",
          position: 1,
        }],
        channels: [],
        sources: [{ url: "https://fripside.net/test" }],
      },
    }, actor, "request-1");

    expect(event.location_mode).toBe("physical");
    expect(event.venue_label).toBe("新宿LOFT");
    expect(event.area_label).toBe("新宿区");
    expect(event.venues).toHaveLength(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM venue_aliases").get()).toMatchObject({ count: 1 });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });

  it("publishes an MCP change set with a structured online channel", async () => {
    const sqlite = new DatabaseSync(":memory:");
    for (const name of ["0001_initial.sql", "0002_import_jobs.sql", "0003_music_library.sql", "0004_structured_locations.sql", "0005_journey_coordinates.sql", "0006_journey_coordinate_data.sql", "0016_event_alias_tours.sql", "0018_admin_chat.sql", "0019_admin_chat_history.sql"]) {
      sqlite.exec(migration(name));
    }
    const db = new TestD1(sqlite) as unknown as D1Database;
    const actor: Actor = {
      id: "publisher", type: "human", channel: "mcp",
      scopes: ["events:read", "events:draft", "events:publish"],
    };
    const service = new ChangeService(db);
    const change = await service.proposeCreate({
      event: {
        title: "Online event",
        start_date: "2026-08-24",
        timezone: "Asia/Tokyo",
        category: "MEDIA",
        status: "scheduled",
        location_mode: "online",
        venues: [],
        channels: [{ channel_type: "streaming", name: "YouTube", url: "https://www.youtube.com/" }],
        sources: [{ url: "https://fripside.net/online-test" }],
      },
      reason: "verified announcement",
      idempotency_key: "online-change-create",
    }, actor, "request-2");

    const preview = await service.preview(change.id, actor);
    expect(preview.after.location_input?.channels[0].name).toBe("YouTube");
    const event = await service.publish(change.id, actor, "online-change-publish", "request-3");
    expect(event.location_label).toBe("YouTube");
    expect(event.channels[0].channel_type).toBe("streaming");
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });
  it("publishes a stale proposal only against the version the reviewer previewed", async () => {
    const sqlite = new DatabaseSync(":memory:");
    for (const name of ["0001_initial.sql", "0002_import_jobs.sql", "0003_music_library.sql", "0004_structured_locations.sql", "0005_journey_coordinates.sql", "0006_journey_coordinate_data.sql", "0016_event_alias_tours.sql", "0018_admin_chat.sql", "0019_admin_chat_history.sql"]) {
      sqlite.exec(migration(name));
    }
    const db = new TestD1(sqlite) as unknown as D1Database;
    const actor: Actor = { id: "publisher", type: "human", channel: "admin", scopes: ["events:read", "events:draft", "events:publish"] };
    const draft = {
      title: "Stale proposal test",
      start_date: "2026-09-01",
      timezone: "Asia/Tokyo",
      category: "EVENT" as const,
      status: "scheduled" as const,
      location_mode: "none" as const,
      location_note: null,
      venues: [],
      channels: [],
      sources: [{ url: "https://fripside.net/stale-test" }],
    };
    const admin = new ContentAdminService(db);
    const created = await admin.saveEvent({ published: true, idempotency_key: "stale-create", event: draft }, actor, "request-1");
    const service = new ChangeService(db);
    const change = await service.proposeUpdate({
      target_event_id: created.id,
      expected_version: created.version,
      patch: { remark: "from proposal" },
      source_url: "https://fripside.net/stale-test",
      reason: "official update",
      idempotency_key: "stale-propose",
    }, actor, "request-2");
    const edited = await admin.saveEvent({ id: created.id, expected_version: created.version, published: true, idempotency_key: "stale-edit", event: { ...draft, title: "Edited meanwhile" } }, actor, "request-3");
    expect(edited.version).toBe(created.version + 1);

    await expect(service.publish(change.id, actor, "stale-publish-1", "request-4")).rejects.toMatchObject({ code: "version_conflict" });
    await expect(service.publish(change.id, actor, "stale-publish-2", "request-5", { reviewedVersion: created.version })).rejects.toMatchObject({ code: "version_conflict" });
    const published = await service.publish(change.id, actor, "stale-publish-3", "request-6", { reviewedVersion: edited.version });
    expect(published).toMatchObject({ title: "Edited meanwhile", remark: "from proposal", version: edited.version + 1 });
    expect(sqlite.prepare("SELECT status FROM change_sets WHERE id = ?").get(change.id)).toMatchObject({ status: "published" });
    const audit = sqlite.prepare("SELECT metadata_json FROM audit_logs WHERE action = 'change.publish_update'").get() as { metadata_json: string };
    expect(JSON.parse(audit.metadata_json)).toMatchObject({ change_set_id: change.id, base_version: created.version, reviewed_version: edited.version });
    sqlite.close();
  });
});

describe("venue address proposals", () => {
  async function setup() {
    const sqlite = new DatabaseSync(":memory:");
    for (const name of ["0001_initial.sql", "0002_import_jobs.sql", "0003_music_library.sql", "0004_structured_locations.sql", "0005_journey_coordinates.sql", "0006_journey_coordinate_data.sql", "0016_event_alias_tours.sql", "0018_admin_chat.sql", "0019_admin_chat_history.sql"]) {
      sqlite.exec(migration(name));
    }
    const db = new TestD1(sqlite) as unknown as D1Database;
    const actor: Actor = { id: "publisher", type: "human", channel: "mcp", scopes: ["events:read", "events:draft", "events:publish"] };
    const admin = new ContentAdminService(db);
    const draft = (title: string, date: string, venue: object) => ({
      title, start_date: date, timezone: "Asia/Tokyo", category: "LIVE" as const, status: "scheduled" as const,
      location_mode: "physical" as const, location_note: null, channels: [],
      venues: [{ role: "primary" as const, position: 1, ...venue }],
      sources: [{ url: `https://fripside.net/${encodeURIComponent(title)}` }],
    });
    const first = await admin.saveEvent({ published: true, idempotency_key: "venue-address-first",
      event: draft("Day 1", "2026-08-23", { canonical_name: "新宿LOFT", display_name_snapshot: "LOFT", address_text: "旧地址" }) }, actor);
    const venueId = first.venues[0].id;
    const second = await admin.saveEvent({ published: true, idempotency_key: "venue-address-second",
      event: draft("Day 2", "2026-08-24", { venue_id: venueId }) }, actor);
    const propose = (patch: object, key: string, target = first) => new ChangeService(db).proposeUpdate({
      target_event_id: target.id, expected_version: target.version, patch,
      source_url: "https://fripside.net/venue-address", reason: "official access page", idempotency_key: key,
    }, actor);
    return { sqlite, db, actor, service: new ChangeService(db), first, second, venueId, propose };
  }

  it("previews and publishes an address edit without touching the event's venue link", async () => {
    const { sqlite, actor, service, first, second, venueId, propose } = await setup();
    const change = await propose({ venue_updates: [{ venue_id: venueId, address_text: " 東京都新宿区歌舞伎町1-12-9 " }] }, "venue-address-propose");

    const preview = await service.preview(change.id, actor);
    expect(preview.venue_changes).toEqual([{
      venue_id: venueId, canonical_name: "新宿LOFT", before: "旧地址", after: "東京都新宿区歌舞伎町1-12-9", other_event_count: 1,
    }]);
    expect(preview.after.venues?.[0].address_text).toBe("東京都新宿区歌舞伎町1-12-9");
    expect(preview.after.location_input).toBeUndefined();
    expect(preview.warnings).toContain("场馆「新宿LOFT」还关联 1 个其他活动，地址修改对它们同样生效");
    expect(sqlite.prepare("SELECT address_text FROM venues WHERE id = ?").get(venueId)).toMatchObject({ address_text: "旧地址" });

    const published = await service.publish(change.id, actor, "venue-address-publish");
    expect(published.version).toBe(first.version + 1);
    expect(published.venues[0]).toMatchObject({ id: venueId, address_text: "東京都新宿区歌舞伎町1-12-9", display_name_snapshot: "LOFT", role: "primary" });
    expect(sqlite.prepare("SELECT version FROM events WHERE id = ?").get(second.id)).toMatchObject({ version: second.version });
    const audit = sqlite.prepare("SELECT before_json, after_json, metadata_json FROM audit_logs WHERE action = 'change.publish_update'").get() as Record<string, string>;
    expect(JSON.parse(audit.before_json).venues[0].address_text).toBe("旧地址");
    expect(JSON.parse(audit.after_json).venues[0].address_text).toBe("東京都新宿区歌舞伎町1-12-9");
    expect(JSON.parse(audit.metadata_json).venue_changes).toEqual([{ venue_id: venueId, before: "旧地址", after: "東京都新宿区歌舞伎町1-12-9" }]);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });

  it("clears an address with null and leaves it unchanged when the publish loses the version race", async () => {
    const { sqlite, actor, service, first, venueId, propose } = await setup();
    const clear = await propose({ venue_updates: [{ venue_id: venueId, address_text: null }] }, "venue-address-clear");
    const rival = await propose({ remark: "rival" }, "venue-address-rival");
    await service.publish(rival.id, actor, "venue-address-rival-publish");
    await expect(service.publish(clear.id, actor, "venue-address-clear-stale")).rejects.toMatchObject({ code: "version_conflict" });
    expect(sqlite.prepare("SELECT address_text FROM venues WHERE id = ?").get(venueId)).toMatchObject({ address_text: "旧地址" });

    await service.publish(clear.id, actor, "venue-address-clear-reviewed", undefined, { reviewedVersion: first.version + 1 });
    expect(sqlite.prepare("SELECT address_text FROM venues WHERE id = ?").get(venueId)).toMatchObject({ address_text: null });
    sqlite.close();
  });

  it("rejects venues the event does not link to", async () => {
    const { sqlite, db, actor, service, first, venueId, propose } = await setup();
    const elsewhere = await new ContentAdminService(db).saveEvent({ published: true, idempotency_key: "venue-address-elsewhere", event: {
      title: "Elsewhere", start_date: "2026-08-25", timezone: "Asia/Tokyo", category: "LIVE", status: "scheduled",
      location_mode: "physical", location_note: null, channels: [], venues: [{ canonical_name: "Zepp Haneda", role: "primary", position: 1 }],
      sources: [{ url: "https://fripside.net/elsewhere" }],
    } }, actor);
    const otherVenue = elsewhere.venues[0].id;
    await expect(propose({ venue_updates: [{ venue_id: otherVenue, address_text: "x" }] }, "venue-address-unlinked"))
      .rejects.toMatchObject({ code: "venue_not_linked", details: { venue_ids: [otherVenue] } });
    await expect(propose({ venue_updates: [{ venue_id: "ven_missing", address_text: "x" }] }, "venue-address-missing"))
      .rejects.toMatchObject({ code: "venue_not_linked" });
    await expect(propose({ venue_updates: [{ venue_id: venueId, address_text: "a" }, { venue_id: venueId, address_text: "b" }] }, "venue-address-duplicate"))
      .rejects.toThrow();

    // Relinking the event to another venue in the same patch makes that venue editable instead.
    const relink = await propose({
      venues: [{ venue_id: otherVenue, role: "primary", position: 1 }],
      venue_updates: [{ venue_id: otherVenue, address_text: "東京都大田区羽田空港1-1-4" }],
    }, "venue-address-relink");
    const published = await service.publish(relink.id, actor, "venue-address-relink-publish");
    expect(published.venues.map((venue) => [venue.id, venue.address_text])).toEqual([[otherVenue, "東京都大田区羽田空港1-1-4"]]);
    expect(sqlite.prepare("SELECT address_text FROM venues WHERE id = ?").get(venueId)).toMatchObject({ address_text: "旧地址" });
    expect(first.venues[0].id).toBe(venueId);
    sqlite.close();
  });
});

describe("content admin tour stops", () => {
  async function setup() {
    const sqlite = new DatabaseSync(":memory:");
    for (const name of ["0001_initial.sql", "0002_import_jobs.sql", "0003_music_library.sql", "0004_structured_locations.sql", "0005_journey_coordinates.sql", "0006_journey_coordinate_data.sql", "0016_event_alias_tours.sql", "0018_admin_chat.sql", "0019_admin_chat_history.sql"]) {
      sqlite.exec(migration(name));
    }
    const db = new TestD1(sqlite) as unknown as D1Database;
    const actor: Actor = { id: "tester", type: "human", channel: "admin", scopes: ["events:publish"] };
    const service = new ContentAdminService(db);
    const tour = await service.saveTour({ name: "Tour A", published: true, idempotency_key: "tour-a-create" }, actor);
    const other = await service.saveTour({ name: "Tour B", published: true, idempotency_key: "tour-b-create" }, actor);
    const makeEvent = (title: string, date: string, display?: { tour_id: string; tour_stop: string }) => service.saveEvent({
      published: true,
      idempotency_key: `event-${title}`,
      event: {
        title, start_date: date, timezone: "Asia/Tokyo", category: "LIVE", status: "scheduled",
        location_mode: "none", location_note: null, venues: [], channels: [],
        sources: [{ url: `https://fripside.net/${encodeURIComponent(title)}` }],
      },
      display,
    }, actor);
    return { sqlite, db, actor, service, tour, other, makeEvent };
  }

  it("adds, moves and removes stops with version bumps and audit rows", async () => {
    const { sqlite, db, actor, service, tour, other, makeEvent } = await setup();
    const free = await makeEvent("Free show", "2026-10-01");
    const moved = await makeEvent("Moved show", "2026-10-02", { tour_id: other.id, tour_stop: "大阪" });

    const result = await service.updateTourStops({
      tour_id: tour.id, idempotency_key: "tour-stops-add", add_event_ids: [free.id, moved.id],
    }, actor);
    expect(result).toMatchObject({ added: 2, removed: 0 });
    expect(result.tour.stops.map((stop) => stop.event_id)).toEqual([free.id, moved.id]);
    const movedRow = sqlite.prepare("SELECT tour_id, tour_stop, version FROM events WHERE id = ?").get(moved.id);
    expect(movedRow).toMatchObject({ tour_id: tour.id, tour_stop: null, version: moved.version + 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'content.event.tour'").get()).toMatchObject({ count: 2 });

    const replay = await service.updateTourStops({
      tour_id: tour.id, idempotency_key: "tour-stops-add", add_event_ids: [free.id, moved.id],
    }, actor);
    expect(replay).toMatchObject({ added: 0, removed: 0 });

    const removed = await service.updateTourStops({
      tour_id: tour.id, idempotency_key: "tour-stops-remove", remove_event_ids: [free.id],
    }, actor);
    expect(removed).toMatchObject({ added: 0, removed: 1 });
    expect(removed.tour.stops.map((stop) => stop.event_id)).toEqual([moved.id]);
    expect((await db.prepare("SELECT tour_id FROM events WHERE id = ?").bind(free.id).first())).toMatchObject({ tour_id: null });
    sqlite.close();
  });

  it("rejects archived or unknown events and ignores no-op removals", async () => {
    const { sqlite, actor, service, tour, other, makeEvent } = await setup();
    const elsewhere = await makeEvent("Elsewhere", "2026-11-01", { tour_id: other.id, tour_stop: "東京" });
    await expect(service.updateTourStops({
      tour_id: tour.id, idempotency_key: "tour-stops-missing", add_event_ids: ["evt_missing"],
    }, actor)).rejects.toThrow("不存在或已归档");

    const noop = await service.updateTourStops({
      tour_id: tour.id, idempotency_key: "tour-stops-noop", remove_event_ids: [elsewhere.id],
    }, actor);
    expect(noop).toMatchObject({ added: 0, removed: 0 });
    expect(sqlite.prepare("SELECT tour_id, tour_stop FROM events WHERE id = ?").get(elsewhere.id)).toMatchObject({ tour_id: other.id, tour_stop: "東京" });
    sqlite.close();
  });
});
