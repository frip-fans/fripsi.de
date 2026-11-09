/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { ContentAdminService } from "./content-admin";
import { songPhaseMask, songPhasesFromMask } from "./music-types";
import { createTestD1 } from "./test-d1";
import type { Actor } from "./types";

const actor: Actor = { id: "tester", type: "human", channel: "admin", scopes: ["music:write"] };

describe("song phase", () => {
  it("round-trips phases through the bit mask", () => {
    expect(songPhaseMask([1, 2, 3])).toBe(7);
    expect(songPhaseMask([2])).toBe(2);
    expect(songPhaseMask([])).toBeNull();
    expect(songPhasesFromMask(5)).toEqual([1, 3]);
    expect(songPhasesFromMask(null)).toEqual([]);
  });
  it("saves joint phases, keeps them when a caller omits the field, and clears them with an empty list", async () => {
    const { db, sqlite } = createTestD1();
    const service = new ContentAdminService(db);
    const input = {
      title: "only my railgun", original_artist: "fripSide", published: true, aliases: [], sources: [],
      versions: [{ title: "only my railgun", artist_credit: "fripSide", published: true, sources: [] }],
    };
    const created = await service.saveSong({ ...input, phases: [1, 2], idempotency_key: "phase-create-1" }, actor);
    expect(created.phase_mask).toBe(3);
    const kept = await service.saveSong({ ...input, id: created.id, expected_updated_at: created.updated_at, versions: created.versions.map(version => ({ ...version, sources: [] })), idempotency_key: "phase-keep-1" }, actor);
    expect(kept.phase_mask).toBe(3);
    const cleared = await service.saveSong({ ...input, id: created.id, expected_updated_at: kept.updated_at, versions: kept.versions.map(version => ({ ...version, sources: [] })), phases: [], idempotency_key: "phase-clear-1" }, actor);
    expect(cleared.phase_mask).toBeNull();
    await expect(service.saveSong({ ...input, phases: [4], idempotency_key: "phase-invalid-1" }, actor)).rejects.toThrow();
    expect(() => sqlite.exec("UPDATE songs SET phase_mask = 8")).toThrow();
    sqlite.close();
  });
});
