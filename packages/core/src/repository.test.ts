import { describe, expect, it } from "vitest";
import { countAuditLogs, countEvents, getLastOfficialSyncAt, listAuditLogs, searchEvents } from "./repository";
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

    // The text query resolves to matching ids first (see search-index); the page query binds them as JSON.
    const page = calls.find((call) => call.sql.includes("LIMIT ? OFFSET ?"));
    expect(page?.bindings).toEqual(["[]", "LIVE", 50, 100]);
  });

  it("keeps chronological order by default and sorts newest first on request", async () => {
    const { db, calls } = fakeDb();

    await searchEvents(db, { limit: 50 });
    await searchEvents(db, { limit: 50 }, false, { newestFirst: true });

    expect(calls[0].sql).toContain("ORDER BY start_date ASC, start_time ASC");
    expect(calls[1].sql).toContain("ORDER BY start_date DESC, start_time DESC");
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

describe("audit log paging", () => {
  function seed() {
    const { db, sqlite } = createTestD1();
    const insert = sqlite.prepare("INSERT INTO audit_logs (id,actor_id,actor_type,channel,action,target_type,target_id,request_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)");
    const rows: Array<[string, string, string, string, string, string, string]> = [
      ["a1", "editor@example.com", "admin", "event.update", "event", "evt_1", "2026-10-01T00:00:00Z"],
      // Two writes of one request share a timestamp.
      ["a2", "sync-agent", "mcp", "change.propose_update", "change_set", "chg_1", "2026-10-02T00:00:00Z"],
      ["a3", "sync-agent", "mcp", "change.publish_update", "event", "evt_1", "2026-10-02T00:00:00Z"],
      ["a4", "syncXagent", "mcp", "event.create", "event", "evt_2", "2026-10-03T00:00:00Z"],
    ];
    for (const [id, actor, channel, action, targetType, targetId, createdAt] of rows) {
      insert.run(id, actor, channel === "admin" ? "human" : "ai", channel, action, targetType, targetId, `req_${id}`, createdAt);
    }
    return db;
  }

  it("pages newest first without repeating or skipping same-timestamp rows", async () => {
    const db = seed();
    const first = await listAuditLogs(db, 2);
    const second = await listAuditLogs(db, 2, { offset: 2 });
    expect([...first, ...second].map((log) => log.id)).toEqual(["a4", "a3", "a2", "a1"]);
    expect(await countAuditLogs(db)).toBe(4);
  });

  it("filters the list and the count the same way", async () => {
    const db = seed();
    const filters = { target_type: "event", channel: "mcp" };
    expect((await listAuditLogs(db, 50, filters)).map((log) => log.id)).toEqual(["a4", "a3"]);
    expect(await countAuditLogs(db, filters)).toBe(2);
    expect((await listAuditLogs(db, 50, { query: "evt_1" })).map((log) => log.id)).toEqual(["a3", "a1"]);
    expect((await listAuditLogs(db, 50, { query: "req_a2" })).map((log) => log.id)).toEqual(["a2"]);
  });

  it("matches wildcard characters in the query literally", async () => {
    const db = seed();
    // "_" must not match the "X" in syncXagent, and "%" must not match everything.
    expect(await countAuditLogs(db, { query: "sync_agent" })).toBe(0);
    expect(await countAuditLogs(db, { query: "sync-agent" })).toBe(2);
    expect(await countAuditLogs(db, { query: "%" })).toBe(0);
  });
});
