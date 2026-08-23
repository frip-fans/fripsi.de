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
    for (const name of ["0001_initial.sql", "0002_import_jobs.sql", "0003_music_library.sql", "0004_structured_locations.sql", "0005_journey_coordinates.sql", "0006_journey_coordinate_data.sql"]) {
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
    for (const name of ["0001_initial.sql", "0002_import_jobs.sql", "0003_music_library.sql", "0004_structured_locations.sql", "0005_journey_coordinates.sql", "0006_journey_coordinate_data.sql"]) {
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
});
