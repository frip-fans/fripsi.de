/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ContentAdminService } from "./content-admin";
import { getReleaseBySlug } from "./music-repository";
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

describe("release artwork persistence", () => {
  it("migrates existing records and supports create, read, preserve, clear, and conflict checks", async () => {
    const sqlite = new DatabaseSync(":memory:");
    for (const name of ["0001_initial.sql", "0002_import_jobs.sql", "0003_music_library.sql"]) sqlite.exec(migration(name));
    sqlite.exec("INSERT INTO releases (id,slug,title,release_type,published,created_at,updated_at) VALUES ('old','old-release','Old','album',1,'2026-01-01','2026-01-01')");
    sqlite.exec(migration("0007_release_covers.sql"));
    expect(sqlite.prepare("SELECT cover_url, cover_source_url FROM releases WHERE id = 'old'").get()).toMatchObject({ cover_url: null, cover_source_url: null });
    const db = new TestD1(sqlite) as unknown as D1Database;
    const service = new ContentAdminService(db);
    const actor: Actor = { id: "tester", type: "human", channel: "admin", scopes: ["music:write"] };
    const input = {
      title: "Test album", slug: "test-album", release_type: "album", release_date: "2026-08-26", published: true,
      cover_url: "/media/covers/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg",
      cover_source_url: "https://fripside.net/musics/20902", sources: [], tracks: [], idempotency_key: "cover-create-1",
    };
    const created = await service.saveRelease(input, actor);
    expect(created.cover_url).toBe(input.cover_url);
    expect((await getReleaseBySlug(db, created.slug))?.cover_source_url).toBe(input.cover_source_url);
    const preserved = await service.saveRelease({ ...input, id: created.id, expected_updated_at: created.updated_at, cover_url: undefined, cover_source_url: undefined, idempotency_key: "cover-preserve-1" }, actor);
    expect(preserved.cover_url).toBe(input.cover_url);
    await expect(service.saveRelease({ ...input, id: created.id, expected_updated_at: created.updated_at, idempotency_key: "cover-conflict-1" }, actor)).rejects.toThrow("专辑已经被修改");
    await expect(service.saveRelease({ ...input, cover_url: "https://evil.example/cover.jpg", idempotency_key: "cover-invalid-1" }, actor)).rejects.toThrow();
    await expect(service.saveRelease({ ...input, cover_source_url: null, idempotency_key: "cover-no-source-1" }, actor)).rejects.toThrow("请填写封面来源");
    const cleared = await service.saveRelease({ ...input, id: created.id, expected_updated_at: preserved.updated_at, cover_url: "", cover_source_url: "", idempotency_key: "cover-clear-1" }, actor);
    expect(cleared.cover_url).toBeNull();
    expect((await getReleaseBySlug(db, created.slug))?.cover_url).toBeNull();
    sqlite.close();
  });
});
