/// <reference types="node" />
import { expect, it } from "vitest";
import { ContentAdminService } from "./content-admin";
import { ChangeService } from "./change-service";
import { canonicalClassification, distinctOccurrence, occurrenceLabel } from "./sync-policy";
import { createTestD1 } from "./test-d1";
import type { Actor } from "./types";

it("permits separately identified parts despite sharing a source, venue and calendar date", async () => {
  const { db, sqlite } = createTestD1();
  try {
    const event = { title: "【第1部】infinite Resonance 4", start_date: "2026-10-18", start_time: "13:00", category: "EVENT", location_mode: "physical", venues: [{ canonical_name: "アニメイト大阪日本橋" }], sources: [{ url: "https://fripside.net/contents/1090598" }] };
    await new ContentAdminService(db).saveEvent({ event, published: true, idempotency_key: "part-one-published" }, { id: "editor", type: "human", channel: "admin", scopes: ["events:publish"] });
    const actor: Actor = { id: "agent", type: "ai", channel: "mcp", scopes: ["events:read", "events:draft"] };
    const service = new ChangeService(db);
    const second = await service.proposeCreate({ event: { ...event, title: "【第2部】infinite Resonance 4", start_time: "15:00" }, reason: "official second part", idempotency_key: "part-two-proposed" }, actor);
    expect((await service.preview(second.id, actor)).duplicate_candidates).toEqual([]);
    const duplicate = await service.proposeCreate({ event, reason: "same occurrence again", idempotency_key: "duplicate-part-one" }, actor);
    expect((await service.preview(duplicate.id, actor)).duplicate_candidates).toHaveLength(1);
    const changedTime = await service.proposeCreate({ event: { ...event, start_time: "14:00" }, reason: "same part changed time is still same identity", idempotency_key: "changed-time-part-one" }, actor);
    expect((await service.preview(changedTime.id, actor)).duplicate_candidates).toHaveLength(1);
  } finally { sqlite.close(); }
});

it("distinguishes an audience event from a media stream, without assuming every different time is a new event", () => {
  expect(canonicalClassification("LIVE", "ワンマン")).toBe("专场");
  expect(occurrenceLabel("【第２部】イベント")).toBe("part:2");
  expect(distinctOccurrence({ title: "program", category: "MEDIA", location_mode: "online" }, { title: "program", category: "EVENT", location_mode: "undisclosed" })).toBe(true);
  expect(distinctOccurrence({ title: "program", category: "MEDIA", location_mode: "online" }, { title: "program", category: "MEDIA", location_mode: "online" })).toBe(false);
});
