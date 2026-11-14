/// <reference types="node" />
import { beforeEach, expect, it } from "vitest";
import {
  CHAT_MODELS_MAX,
  CHAT_MODELS_SETTING,
  readChatModelSettings,
  validateChatModelSelection,
  writeSetting,
} from "./app-settings";
import { createTestD1 } from "./test-d1";
import { ServiceError } from "./utils";

const actor = "maintainer@example.com";
let db: D1Database;
beforeEach(() => { db = createTestD1().db; });

it("reports nothing configured before anyone saves", async () => {
  const settings = await readChatModelSettings(db);
  expect(settings).toMatchObject({ enabled: [], default_model: null, updated_at: null });
});

it("stores a selection and reads it back with its audit fields", async () => {
  const now = new Date("2026-11-14T02:00:00.000Z");
  await writeSetting(db, CHAT_MODELS_SETTING, { enabled: ["gpt-6-luna", "gpt-6.1-sol"], default_model: "gpt-6.1-sol" }, actor, now);
  const settings = await readChatModelSettings(db);
  expect(settings.enabled).toEqual(["gpt-6-luna", "gpt-6.1-sol"]);
  expect(settings.default_model).toBe("gpt-6.1-sol");
  expect(settings.updated_by).toBe(actor);
  expect(settings.updated_at).toBe(now.toISOString());
});

it("replaces the previous selection instead of adding a second row", async () => {
  await writeSetting(db, CHAT_MODELS_SETTING, { enabled: ["a"], default_model: "a" }, actor);
  await writeSetting(db, CHAT_MODELS_SETTING, { enabled: ["b"], default_model: "b" }, actor);
  expect((await readChatModelSettings(db)).enabled).toEqual(["b"]);
  const rows = await db.prepare("SELECT COUNT(*) AS n FROM app_settings").all<{ n: number }>();
  expect(rows.results[0].n).toBe(1);
});

it("degrades to nothing configured rather than failing on a malformed row", async () => {
  await db.prepare("INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?)")
    .bind(CHAT_MODELS_SETTING, "{not json", new Date().toISOString()).run();
  expect((await readChatModelSettings(db)).enabled).toEqual([]);
});

it("drops junk entries and a default that is not among the enabled models", async () => {
  await writeSetting(db, CHAT_MODELS_SETTING,
    { enabled: ["gpt-6-luna", 42, "has space", "gpt-6-luna"], default_model: "gpt-6.1-sol" }, actor);
  const settings = await readChatModelSettings(db);
  expect(settings.enabled).toEqual(["gpt-6-luna"]);
  expect(settings.default_model).toBeNull();
});

it("accepts a selection drawn from the provider list", () => {
  expect(validateChatModelSelection(["a", "b"], "b", ["a", "b", "c"]))
    .toEqual({ enabled: ["a", "b"], default_model: "b" });
});

it("rejects a model the API key cannot reach", () => {
  expect(() => validateChatModelSelection(["a", "ghost"], null, ["a"])).toThrow(ServiceError);
});

it("rejects a default outside the selection, and more models than the cap", () => {
  expect(() => validateChatModelSelection(["a"], "b", ["a", "b"])).toThrow(ServiceError);
  const many = Array.from({ length: CHAT_MODELS_MAX + 1 }, (_, index) => `m${index}`);
  expect(() => validateChatModelSelection(many, null, many)).toThrow(ServiceError);
});

it("clears the default when the selection is emptied", () => {
  expect(validateChatModelSelection([], "a", ["a"])).toEqual({ enabled: [], default_model: null });
});
