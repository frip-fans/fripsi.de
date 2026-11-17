/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ContentAdminService } from "./content-admin";
import { ChangeService } from "./change-service";
import type { Actor } from "./types";
import { getVenueById, listVenueUsage } from "./venues";

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

describe("venue record proposals", () => {
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
    const first = await admin.saveEvent({ published: true, idempotency_key: "venue-edit-first",
      event: draft("Day 1", "2026-08-23", { canonical_name: "新宿LOFT", display_name_snapshot: "LOFT", address_text: "旧地址" }) }, actor);
    const venueId = first.venues[0].id;
    const second = await admin.saveEvent({ published: true, idempotency_key: "venue-edit-second",
      event: draft("Day 2", "2026-08-24", { venue_id: venueId }) }, actor);
    const service = new ChangeService(db);
    const propose = (patch: object, key: string, target = first) => service.proposeUpdate({
      target_event_id: target.id, expected_version: target.version, patch,
      source_url: "https://fripside.net/venue-edit", reason: "official access page", idempotency_key: key,
    }, actor);
    const venue = () => sqlite.prepare("SELECT * FROM venues WHERE id = ?").get(venueId) as Record<string, unknown>;
    return { sqlite, db, actor, service, first, second, venueId, propose, venue };
  }

  it("previews and publishes an address edit without touching the event's venue link", async () => {
    const { sqlite, actor, service, first, second, venueId, propose, venue } = await setup();
    const change = await propose({ venue_updates: [{ venue_id: venueId, address_text: " 東京都新宿区歌舞伎町1-12-9 " }] }, "venue-address-propose");

    const preview = await service.preview(change.id, actor);
    expect(preview.venue_changes).toEqual([{
      venue_id: venueId, canonical_name: "新宿LOFT", other_event_count: 1,
      fields: [{ field: "address_text", before: "旧地址", after: "東京都新宿区歌舞伎町1-12-9" }],
    }]);
    expect(preview.after.venues?.[0].address_text).toBe("東京都新宿区歌舞伎町1-12-9");
    expect(preview.after.location_input).toBeUndefined();
    expect(preview.warnings).toEqual(["场馆「新宿LOFT」还关联 1 个其他活动，修改对它们同样生效"]);
    expect(venue().address_text).toBe("旧地址");

    const published = await service.publish(change.id, actor, "venue-address-publish");
    expect(published.version).toBe(first.version + 1);
    expect(published.venues[0]).toMatchObject({ id: venueId, canonical_name: "新宿LOFT", address_text: "東京都新宿区歌舞伎町1-12-9", display_name_snapshot: "LOFT", role: "primary" });
    expect(sqlite.prepare("SELECT version FROM events WHERE id = ?").get(second.id)).toMatchObject({ version: second.version });
    const audit = sqlite.prepare("SELECT before_json, after_json, metadata_json FROM audit_logs WHERE action = 'change.publish_update'").get() as Record<string, string>;
    expect(JSON.parse(audit.before_json).venues[0].address_text).toBe("旧地址");
    expect(JSON.parse(audit.after_json).venues[0].address_text).toBe("東京都新宿区歌舞伎町1-12-9");
    expect(JSON.parse(audit.metadata_json).venue_changes).toEqual([{ venue_id: venueId, fields: preview.venue_changes![0].fields }]);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });

  it("renames a venue, moves it to another area and sets coordinates in one proposal", async () => {
    const { sqlite, actor, service, venueId, propose, venue } = await setup();
    const change = await propose({ venue_updates: [{
      venue_id: venueId, canonical_name: "新宿LOFT（歌舞伎町）", administrative_area_id: "area_jp_13104",
      latitude: 35.6955, longitude: 139.7025, coordinate_precision: "building", coordinate_source: "official access page",
    }] }, "venue-record-propose");

    const preview = await service.preview(change.id, actor);
    expect(preview.venue_changes).toEqual([{
      venue_id: venueId, canonical_name: "新宿LOFT", other_event_count: 1, kept_display_names: 1,
      fields: [
        { field: "canonical_name", before: "新宿LOFT", after: "新宿LOFT（歌舞伎町）" },
        { field: "administrative_area_id", before: null, after: "area_jp_13104", before_label: null, after_label: "新宿区" },
        { field: "latitude", before: null, after: 35.6955 },
        { field: "longitude", before: null, after: 139.7025 },
        { field: "coordinate_precision", before: null, after: "building" },
        { field: "coordinate_source", before: null, after: "official access page" },
      ],
    }]);
    expect(preview.warnings.some((warning) => warning.includes("1 个活动保存了当时显示名"))).toBe(true);

    const published = await service.publish(change.id, actor, "venue-record-publish");
    expect(published).toMatchObject({ venue_label: "LOFT", area_label: "新宿区" });
    expect(venue()).toMatchObject({
      canonical_name: "新宿LOFT（歌舞伎町）", administrative_area_id: "area_jp_13104", address_text: "旧地址",
      latitude: 35.6955, longitude: 139.7025, coordinate_precision: "building", coordinate_source: "official access page",
      coordinates_verified_at: published.updated_at, updated_at: published.updated_at,
    });
    expect(sqlite.prepare("SELECT alias FROM venue_aliases WHERE venue_id = ? ORDER BY alias").all(venueId))
      .toEqual([{ alias: "新宿LOFT" }, { alias: "新宿LOFT（歌舞伎町）" }]);

    // Clearing the coordinates also clears what described them; other fields stay.
    const cleared = await propose({ venue_updates: [{ venue_id: venueId, latitude: null, longitude: null }] }, "venue-record-clear", published);
    expect((await service.preview(cleared.id, actor)).venue_changes![0].fields.map((item) => item.field))
      .toEqual(["latitude", "longitude", "coordinate_precision", "coordinate_source"]);
    await service.publish(cleared.id, actor, "venue-record-clear-publish");
    expect(venue()).toMatchObject({
      canonical_name: "新宿LOFT（歌舞伎町）", administrative_area_id: "area_jp_13104",
      latitude: null, longitude: null, coordinate_precision: null, coordinate_source: null, coordinates_verified_at: null,
    });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });

  it("carries a corrected name to events that showed the old one, leaving custom display names alone", async () => {
    const { sqlite, actor, service, first, second, venueId, propose } = await setup();
    const names = () => sqlite.prepare("SELECT event_id, display_name_snapshot AS name FROM event_venues WHERE venue_id = ?").all(venueId)
      .map((row) => [row.event_id === first.id ? "first" : "second", row.name]).sort();
    sqlite.prepare("UPDATE event_venues SET display_name_snapshot = '新宿LOFT' WHERE event_id = ?").run(second.id);
    expect(names()).toEqual([["first", "LOFT"], ["second", "新宿LOFT"]]);

    const change = await propose({ venue_updates: [{ venue_id: venueId, canonical_name: "新宿ロフト", sync_display_names: true }] }, "venue-rename-sync", second);
    const preview = await service.preview(change.id, actor);
    expect(preview.venue_changes![0]).toMatchObject({ synced_display_names: 1, kept_display_names: 1 });
    expect(preview.after.venues?.[0]).toMatchObject({ canonical_name: "新宿ロフト", display_name_snapshot: "新宿ロフト" });
    expect(preview.warnings).toContain("场馆「新宿LOFT」改名会同步更新 1 个活动的显示名");

    const published = await service.publish(change.id, actor, "venue-rename-sync-publish");
    expect(published.venue_label).toBe("新宿ロフト");
    expect(names()).toEqual([["first", "LOFT"], ["second", "新宿ロフト"]]);
    const audit = sqlite.prepare("SELECT metadata_json FROM audit_logs WHERE action = 'change.publish_update'").get() as { metadata_json: string };
    expect(JSON.parse(audit.metadata_json).venue_changes[0]).toMatchObject({ venue_id: venueId, synced_display_names: 1 });

    await expect(propose({ venue_updates: [{ venue_id: venueId, address_text: "x", sync_display_names: true }] }, "venue-sync-without-rename")).rejects.toThrow();
    await expect(propose({ venue_updates: [{ venue_id: venueId, sync_display_names: true }] }, "venue-sync-alone")).rejects.toThrow();
    sqlite.close();
  });

  it("clears an address with null and leaves it unchanged when the publish loses the version race", async () => {
    const { actor, service, first, venueId, propose, venue } = await setup();
    const clear = await propose({ venue_updates: [{ venue_id: venueId, address_text: null }] }, "venue-address-clear");
    const rival = await propose({ remark: "rival" }, "venue-address-rival");
    await service.publish(rival.id, actor, "venue-address-rival-publish");
    await expect(service.publish(clear.id, actor, "venue-address-clear-stale")).rejects.toMatchObject({ code: "version_conflict" });
    expect(venue().address_text).toBe("旧地址");

    await service.publish(clear.id, actor, "venue-address-clear-reviewed", undefined, { reviewedVersion: first.version + 1 });
    expect(venue().address_text).toBeNull();
  });

  it("rejects edits that cannot be published", async () => {
    const { sqlite, db, actor, service, venueId, propose, venue } = await setup();
    const elsewhere = await new ContentAdminService(db).saveEvent({ published: true, idempotency_key: "venue-edit-elsewhere", event: {
      title: "Elsewhere", start_date: "2026-08-25", timezone: "Asia/Tokyo", category: "LIVE", status: "scheduled",
      location_mode: "physical", location_note: null, channels: [], venues: [{ canonical_name: "Zepp Haneda", role: "primary", position: 1 }],
      sources: [{ url: "https://fripside.net/elsewhere" }],
    } }, actor);
    const otherVenue = elsewhere.venues[0].id;
    await expect(propose({ venue_updates: [{ venue_id: otherVenue, address_text: "x" }] }, "venue-edit-unlinked"))
      .rejects.toMatchObject({ code: "invalid_venue_update", details: { venues: [{ venue_id: otherVenue }] } });
    await expect(propose({ venue_updates: [{ venue_id: "ven_missing", address_text: "x" }] }, "venue-edit-missing"))
      .rejects.toMatchObject({ code: "invalid_venue_update" });
    await expect(propose({ venue_updates: [{ venue_id: venueId, administrative_area_id: "area_nowhere" }] }, "venue-edit-area"))
      .rejects.toThrow("行政区 area_nowhere 不存在");
    await expect(propose({ venue_updates: [{ venue_id: venueId, coordinate_precision: "building" }] }, "venue-edit-precision"))
      .rejects.toThrow("场馆没有坐标");
    for (const [key, update] of Object.entries({
      empty: { venue_id: venueId },
      half: { venue_id: venueId, latitude: 35 },
      mixed: { venue_id: venueId, latitude: null, longitude: 139 },
      blank: { venue_id: venueId, canonical_name: " " },
    })) {
      await expect(propose({ venue_updates: [update] }, `venue-edit-${key}`), key).rejects.toThrow();
    }
    await expect(propose({ venue_updates: [{ venue_id: venueId, address_text: "a" }, { venue_id: venueId, address_text: "b" }] }, "venue-edit-duplicate"))
      .rejects.toThrow();

    // Relinking the event to another venue in the same patch makes that venue editable instead.
    const relink = await propose({
      venues: [{ venue_id: otherVenue, role: "primary", position: 1 }],
      venue_updates: [{ venue_id: otherVenue, address_text: "東京都大田区羽田空港1-1-4" }],
    }, "venue-edit-relink");
    const published = await service.publish(relink.id, actor, "venue-edit-relink-publish");
    expect(published.venues.map((item) => [item.id, item.address_text])).toEqual([[otherVenue, "東京都大田区羽田空港1-1-4"]]);
    expect(venue()).toMatchObject({ canonical_name: "新宿LOFT", address_text: "旧地址" });
    sqlite.close();
  });
});

describe("admin venue save", () => {
  async function setup() {
    const sqlite = new DatabaseSync(":memory:");
    for (const name of ["0001_initial.sql", "0002_import_jobs.sql", "0003_music_library.sql", "0004_structured_locations.sql", "0005_journey_coordinates.sql", "0006_journey_coordinate_data.sql", "0016_event_alias_tours.sql", "0018_admin_chat.sql", "0019_admin_chat_history.sql"]) {
      sqlite.exec(migration(name));
    }
    const db = new TestD1(sqlite) as unknown as D1Database;
    const actor: Actor = { id: "publisher", type: "human", channel: "admin", scopes: ["events:read", "events:publish"] };
    const service = new ContentAdminService(db);
    const event = (title: string, date: string, venue: object) => service.saveEvent({ published: true, idempotency_key: `venue-save-${title}`, event: {
      title, start_date: date, timezone: "Asia/Tokyo", category: "LIVE", status: "scheduled", location_mode: "physical", location_note: null,
      channels: [], venues: [{ role: "primary", position: 1, ...venue }], sources: [{ url: `https://fripside.net/${encodeURIComponent(title)}` }],
    } }, actor);
    const first = await event("Day 1", "2026-08-23", { canonical_name: "新宿LOFT", address_text: "旧地址" });
    const venueId = first.venues[0].id;
    const second = await event("Day 2", "2026-08-24", { venue_id: venueId, display_name_snapshot: "LOFT" });
    const form = (overrides: object = {}) => ({
      id: venueId, canonical_name: "新宿LOFT", administrative_area_id: null, address_text: "旧地址",
      latitude: null, longitude: null, coordinate_precision: null, coordinate_source: null, ...overrides,
    });
    return { sqlite, db, actor, service, first, second, venueId, form };
  }

  it("lists venues with their usage and finds them by alias, address or area", async () => {
    const { sqlite, db, venueId } = await setup();
    sqlite.prepare("INSERT INTO venue_aliases (venue_id, alias) VALUES (?, 'ロフト')").run(venueId);
    expect(await listVenueUsage(db)).toMatchObject([{ id: venueId, canonical_name: "新宿LOFT", event_count: 2 }]);
    for (const query of ["loft", "ロフト", "旧地"]) expect(await listVenueUsage(db, query), query).toHaveLength(1);
    expect(await listVenueUsage(db, "100%")).toHaveLength(0);
    expect(await getVenueById(db, venueId)).toMatchObject({
      aliases: ["ロフト", "新宿LOFT"],
      events: [{ title: "Day 2", display_name_snapshot: "LOFT" }, { title: "Day 1", display_name_snapshot: "新宿LOFT" }],
    });
    expect(await getVenueById(db, "ven_missing")).toBeNull();
    sqlite.close();
  });

  it("saves every field, keeps the old name as an alias and audits the change without touching events", async () => {
    const { sqlite, db, actor, service, first, second, venueId, form } = await setup();
    const before = (await getVenueById(db, venueId))!;
    const saved = await service.saveVenue(form({
      expected_updated_at: before.updated_at, idempotency_key: "venue-save-all",
      canonical_name: "新宿ロフト", administrative_area_id: "area_jp_13104", address_text: "東京都新宿区歌舞伎町1-12-9",
      latitude: 35.6955, longitude: 139.7025, coordinate_precision: "building", coordinate_source: "official",
    }), actor, "request-venue");
    expect(saved).toMatchObject({
      canonical_name: "新宿ロフト", area_name: "新宿区", address_text: "東京都新宿区歌舞伎町1-12-9", latitude: 35.6955, longitude: 139.7025,
      coordinate_precision: "building", coordinate_source: "official", coordinates_verified_at: saved.updated_at,
      aliases: ["新宿LOFT", "新宿ロフト"],
      // Not asked to sync: both links keep the name they displayed.
      events: [{ display_name_snapshot: "LOFT" }, { display_name_snapshot: "新宿LOFT" }],
    });
    expect(saved.updated_at > before.updated_at).toBe(true);
    expect(sqlite.prepare("SELECT version FROM events ORDER BY start_date").all()).toEqual([{ version: first.version }, { version: second.version }]);
    const audit = sqlite.prepare("SELECT actor_id, target_id, before_json, after_json FROM audit_logs WHERE action = 'content.venue.update'").get() as Record<string, string>;
    expect(audit).toMatchObject({ actor_id: "publisher", target_id: venueId });
    expect(JSON.parse(audit.before_json)).toMatchObject({ canonical_name: "新宿LOFT", latitude: null });
    expect(JSON.parse(audit.after_json)).toMatchObject({ canonical_name: "新宿ロフト", latitude: 35.6955 });

    // A replay of the same submission returns the saved record instead of writing again.
    const replay = await service.saveVenue(form({ expected_updated_at: before.updated_at, idempotency_key: "venue-save-all", canonical_name: "replayed" }), actor);
    expect(replay).toMatchObject({ canonical_name: "新宿ロフト", updated_at: saved.updated_at });

    // Emptying the coordinate boxes clears what described them.
    const cleared = await service.saveVenue(form({ expected_updated_at: saved.updated_at, idempotency_key: "venue-save-clear", canonical_name: "新宿ロフト" }), actor);
    expect(cleared).toMatchObject({ administrative_area_id: null, address_text: "旧地址", latitude: null, coordinate_precision: null, coordinates_verified_at: null });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });

  it("carries a corrected name to the links that displayed the old one", async () => {
    const { sqlite, db, actor, service, venueId, form } = await setup();
    const before = (await getVenueById(db, venueId))!;
    const saved = await service.saveVenue(form({
      expected_updated_at: before.updated_at, idempotency_key: "venue-save-sync", canonical_name: "新宿ロフト", sync_display_names: true,
    }), actor);
    expect(saved.events).toMatchObject([{ title: "Day 2", display_name_snapshot: "LOFT" }, { title: "Day 1", display_name_snapshot: "新宿ロフト" }]);
    const audit = sqlite.prepare("SELECT after_json FROM audit_logs WHERE action = 'content.venue.update'").get() as { after_json: string };
    expect(JSON.parse(audit.after_json)).toMatchObject({ synced_display_names: 1 });
    sqlite.close();
  });

  it("refuses stale, unauthorised and invalid saves", async () => {
    const { sqlite, db, actor, service, venueId, form } = await setup();
    const { updated_at } = (await getVenueById(db, venueId))!;
    const save = (overrides: object, key: string, who = actor) => service.saveVenue(form({ expected_updated_at: updated_at, idempotency_key: key, ...overrides }), who);
    await expect(save({ expected_updated_at: "2020-01-01T00:00:00.000Z" }, "venue-save-stale")).rejects.toMatchObject({ code: "version_conflict" });
    await expect(save({}, "venue-save-editor", { ...actor, scopes: ["events:read", "events:draft"] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(save({ id: "ven_missing" }, "venue-save-missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(save({ administrative_area_id: "area_nowhere" }, "venue-save-area")).rejects.toThrow("行政区不存在");
    await expect(save({ canonical_name: " " }, "venue-save-blank")).rejects.toThrow();
    await expect(save({ latitude: 35 }, "venue-save-half")).rejects.toThrow();
    await expect(save({ latitude: Number.NaN, longitude: 139 }, "venue-save-nan")).rejects.toThrow();
    await expect(save({ coordinate_precision: "building" }, "venue-save-precision")).rejects.toThrow();
    expect((await getVenueById(db, venueId))!.updated_at).toBe(updated_at);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'content.venue.update'").get()).toMatchObject({ count: 0 });
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
