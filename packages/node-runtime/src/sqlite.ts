import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export interface LocalDatabase {
  db: D1Database & { getCacheRevision(): string };
  revision(): string;
  close(): void;
}

function input(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("Unsupported SQLite binding; use strings, finite numbers, null, or byte arrays");
}

export function openDatabase(filename: string, options: { readOnly?: boolean } = {}): LocalDatabase {
  if (filename !== ":memory:" && !options.readOnly) mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const sqlite = new DatabaseSync(filename, { timeout: 5000, readOnly: options.readOnly ?? false });
  sqlite.exec("PRAGMA foreign_keys=ON; PRAGMA cache_size=-4096;");
  if (filename !== ":memory:" && !options.readOnly) {
    sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    chmodSync(filename, 0o600);
  }
  const statistics = sqlite.prepare("SELECT total_changes() AS total, changes() AS changes, last_insert_rowid() AS rowid");
  const version = sqlite.prepare("PRAGMA data_version");
  const execute = new WeakMap<object, () => unknown>();
  let ownVersion = 0;
  const revision = () => `${version.get()?.data_version}:${ownVersion}`;
  const make = (sql: string, values: SQLInputValue[] = [], statement = sqlite.prepare(sql)) => {
    const run = () => {
      const start = performance.now();
      const before = Number(statistics.get()?.total ?? 0);
      const results = statement.columns().length ? statement.all(...values) : (statement.run(...values), []);
      const after = statistics.get()!;
      const changed = Number(after.total) !== before;
      if (changed) ownVersion++;
      return { success: true, results, meta: { changes: changed ? Number(after.changes) : 0,
        last_row_id: Number(after.rowid), duration: performance.now() - start,
        served_by: "local-sqlite", rows_read: 0, rows_written: changed ? Number(after.total) - before : 0, size_after: 0 } };
    };
    const wrapper = {
      bind(...params: unknown[]) { return make(sql, params.map(input), statement); },
      async all() { return run(); },
      async run() { return run(); },
      async first(column?: string) {
        const row = run().results[0];
        if (!row) return null;
        if (column === undefined) return row;
        if (!Object.hasOwn(row, column)) throw new Error("Requested SQLite column does not exist");
        return row[column];
      },
      async raw(opts?: { columnNames?: boolean }) {
        const result = run();
        const columns = statement.columns().map((c) => c.name);
        const rows = result.results.map((row) => columns.map((name) => row[name]));
        return opts?.columnNames ? [columns, ...rows] : rows;
      },
    };
    execute.set(wrapper, run);
    return wrapper;
  };
  const db = {
    prepare(sql: string) { return make(sql); },
    async batch(statements: object[]) {
      const actions = statements.map((statement) => {
        const action = execute.get(statement);
        if (!action) throw new TypeError("Batch statements must belong to the same SQLite connection");
        return action;
      });
      // No await between BEGIN and COMMIT: requests cannot interleave inside this transaction.
      sqlite.exec("BEGIN IMMEDIATE");
      try { const results = actions.map((action) => action()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
    async exec(sql: string) {
      const start = performance.now();
      sqlite.exec(sql); ownVersion++;
      return { count: 1, duration: performance.now() - start };
    },
    getCacheRevision: revision,
  } as unknown as LocalDatabase["db"];
  return { db, revision, close() { sqlite.close(); } };
}
