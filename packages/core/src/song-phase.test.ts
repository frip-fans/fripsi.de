/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { ContentAdminService } from "./content-admin";
import { createTestD1 } from "./test-d1";
import type { Actor } from "./types";

const actor: Actor = { id: "tester", type: "human", channel: "admin", scopes: ["music:write"] };

describe("song phase", () => {
  it("saves a phase, keeps it when a caller omits the field, and clears it on explicit null", async () => {
    const { db, sqlite } = createTestD1();
    const service = new ContentAdminService(db);
    const input = {
      title: "only my railgun", original_artist: "fripSide", published: true, aliases: [], sources: [],
      versions: [{ title: "only my railgun", artist_credit: "fripSide", published: true, sources: [] }],
    };
    const created = await service.saveSong({ ...input, phase: 2, idempotency_key: "phase-create-1" }, actor);
    expect(created.phase).toBe(2);
    const kept = await service.saveSong({ ...input, id: created.id, expected_updated_at: created.updated_at, versions: created.versions.map(version => ({ ...version, sources: [] })), idempotency_key: "phase-keep-1" }, actor);
    expect(kept.phase).toBe(2);
    const cleared = await service.saveSong({ ...input, id: created.id, expected_updated_at: kept.updated_at, versions: kept.versions.map(version => ({ ...version, sources: [] })), phase: null, idempotency_key: "phase-clear-1" }, actor);
    expect(cleared.phase).toBeNull();
    await expect(service.saveSong({ ...input, phase: 4, idempotency_key: "phase-invalid-1" }, actor)).rejects.toThrow();
    expect(() => sqlite.exec("UPDATE songs SET phase = 0")).toThrow();
    sqlite.close();
  });
});
