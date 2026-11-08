import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChangeService, type Actor } from "@frip-fan/core";
import { openDatabase } from "./sqlite";

describe("local SQLite database contract", () => {
  it("supports bindings, scalar first, SELECT batch and optimistic update counts", async () => {
    const store = openDatabase(":memory:");
    try {
      await store.db.exec("CREATE TABLE items(id TEXT PRIMARY KEY, version INTEGER); INSERT INTO items VALUES('a',1)");
      expect(await store.db.prepare("SELECT version FROM items WHERE id=?").bind("a").first("version")).toBe(1);
      const result = await store.db.batch([
        store.db.prepare("UPDATE items SET version=version+1 WHERE id=? AND version=?").bind("a",1),
        store.db.prepare("SELECT version FROM items WHERE id=?").bind("a"),
      ]);
      expect(result[0].meta.changes).toBe(1);
      expect(result[1].results).toEqual([{ version: 2 }]);
      expect((await store.db.prepare("UPDATE items SET version=3 WHERE id=? AND version=?").bind("a",1).run()).meta.changes).toBe(0);
    } finally { store.close(); }
  });
  it("rolls back the entire batch when a later write fails", async () => {
    const store = openDatabase(":memory:");
    try {
      await store.db.exec("CREATE TABLE items(id TEXT PRIMARY KEY); INSERT INTO items VALUES('a')");
      await expect(store.db.batch([store.db.prepare("INSERT INTO items VALUES('b')"),store.db.prepare("INSERT INTO items VALUES('a')")])).rejects.toThrow();
      expect(await store.db.prepare("SELECT COUNT(*) AS count FROM items").first("count")).toBe(1);
    } finally { store.close(); }
  });
  it("detects writes from another process connection for public cache invalidation", async () => {
    const directory = mkdtempSync(join(tmpdir(),"frip-sqlite-"));
    const first = openDatabase(join(directory,"site.sqlite"));
    const second = openDatabase(join(directory,"site.sqlite"));
    try {
      await first.db.exec("CREATE TABLE items(id TEXT PRIMARY KEY)");
      const revision = first.revision();
      await second.db.prepare("INSERT INTO items VALUES(?)").bind("a").run();
      expect(first.revision()).not.toBe(revision);
      expect(await first.db.prepare("SELECT id FROM items").first("id")).toBe("a");
    } finally { first.close(); second.close(); rmSync(directory,{recursive:true,force:true}); }
  });
  it("publishes and audits a real change set using the local adapter", async () => {
    const store = openDatabase(":memory:");
    try {
      const directory = new URL("../../../migrations/", import.meta.url);
      for (const name of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
        await store.db.exec(readFileSync(new URL(name, directory), "utf8"));
      }
      const actor: Actor = { id: "publisher", type: "human", channel: "mcp", scopes: ["events:read", "events:draft", "events:publish"] };
      const service = new ChangeService(store.db);
      const change = await service.proposeCreate({ event: { title: "Adapter integration event", start_date: "2026-11-08", timezone: "Asia/Tokyo", category: "MEDIA", status: "scheduled", location_mode: "online", venues: [], channels: [{ channel_type: "streaming", name: "YouTube", url: "https://www.youtube.com/" }], sources: [{ url: "https://fripside.net/adapter-test" }] }, reason: "adapter test", idempotency_key: "create-local-test" }, actor, "request-local-create");
      expect((await service.preview(change.id, actor)).after.title).toBe("Adapter integration event");
      const event = await service.publish(change.id, actor, "publish-local-test", "request-local-publish");
      expect(event.location_label).toBe("YouTube");
      expect(await store.db.prepare("SELECT count(*) AS n FROM audit_logs").first("n")).toBeGreaterThan(0);
      expect((await store.db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    } finally { store.close(); }
  });

});
