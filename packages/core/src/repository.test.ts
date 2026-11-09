import { describe, expect, it } from "vitest";
import { countEvents, getLastOfficialSyncAt, searchEvents } from "./repository";
import { createTestD1 } from "./test-d1";

interface QueryCall {
  sql: string;
  bindings: unknown[];
}

function fakeDb(firstResult: unknown = null): { db: D1Database; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const db = {
    prepare(sql: string) {
      const call: QueryCall = { sql, bindings: [] };
      calls.push(call);
      const statement = {
        bind(...bindings: unknown[]) {
          call.bindings = bindings;
          return statement;
        },
        async all() {
          return { results: [] };
        },
        async first() {
          return firstResult;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, calls };
}

describe("event repository pagination", () => {
  it("applies the requested limit and offset after filter bindings", async () => {
    const { db, calls } = fakeDb();

    await searchEvents(db, {
      query: "Tokyo",
      categories: ["LIVE"],
      include_archived: true,
      limit: 50,
      offset: 100,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("LIMIT ? OFFSET ?");
    expect(calls[0].bindings).toEqual([
      "%Tokyo%", "%Tokyo%", "%Tokyo%", "%Tokyo%", "%Tokyo%", "%Tokyo%",
      "LIVE", 50, 100,
    ]);
  });

  it("counts the same filtered result set without pagination bindings", async () => {
    const { db, calls } = fakeDb({ count: 137 });

    const total = await countEvents(db, {
      statuses: ["scheduled"],
      include_archived: false,
      limit: 50,
      offset: 100,
    });

    expect(total).toBe(137);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("SELECT COUNT(*) AS count FROM events");
    expect(calls[0].sql).toContain("archived_at IS NULL");
    expect(calls[0].bindings).toEqual(["scheduled"]);
  });
});

describe("last official sync", () => {
  it("reports the newest completed run and nothing while none has finished", async () => {
    const { db, sqlite } = createTestD1();
    try {
      const run = (id: string, status: string, updated: string) =>
        sqlite.prepare("INSERT INTO official_sync_runs (id,status,attempts,created_at,updated_at) VALUES (?,?,1,?,?)")
          .run(id, status, updated, updated);
      run("r1", "running", "2026-11-09T06:00:00Z");
      run("r2", "failed", "2026-11-08T06:00:00Z");
      expect(await getLastOfficialSyncAt(db)).toBeNull();
      run("r3", "completed", "2026-11-05T06:00:00Z");
      run("r4", "completed", "2026-11-07T06:00:00Z");
      expect(await getLastOfficialSyncAt(db)).toBe("2026-11-07T06:00:00Z");
    } finally { sqlite.close(); }
  });
});
