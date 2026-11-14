/// <reference types="node" />
import { beforeEach, describe, expect, it } from "vitest";
import {
  cleanCommentBody, cleanCommentName, CommentError, commentSourceHash, countComments, createComment,
  listAdminComments, listCommentBlocks, listComments, moderateComment, parseCommentThread,
  saveCommentBlockedTerms, unblockCommentSource,
} from "./comments";
import { createTestD1 } from "./test-d1";
import type { Actor } from "./types";

const site = { type: "site", id: "site" } as const;
const publisher: Actor = { id: "owner@example.com", type: "human", channel: "admin", scopes: ["events:publish"] };
const start = new Date("2026-11-15T03:00:00.000Z");
const later = (minutes: number) => new Date(start.valueOf() + minutes * 60_000);
let db: D1Database;

beforeEach(() => {
  const store = createTestD1();
  db = store.db;
  const event = store.sqlite.prepare("INSERT INTO events (id,slug,title,start_date,timezone,category,status,published,archived_at,created_at,updated_at) VALUES (?,?,?,'2026-11-01','Asia/Tokyo','LIVE','completed',?,?,'now','now')");
  event.run("evt_live", "live", "Live", 1, null);
  event.run("evt_draft", "draft", "Draft", 0, null);
  event.run("evt_gone", "gone", "Gone", 1, "now");
});

const post = (body: string, minutes: number, extra: Record<string, unknown> = {}, source = "source-a") =>
  createComment(db, { thread: "site", name: "ナナ", body, ...extra }, source, later(minutes));
const code = async (work: Promise<unknown>) => {
  try { await work; } catch (error) { if (error instanceof CommentError) return error.code; throw error; }
  return null;
};

describe("comment input", () => {
  it("accepts only the site board and event threads", () => {
    expect(parseCommentThread("site")).toEqual(site);
    expect(parseCommentThread("event:evt_live")).toEqual({ type: "event", id: "evt_live" });
    for (const value of ["", "event:", "event:a b", "song:1", null, 3]) expect(parseCommentThread(value)).toBeNull();
  });
  it("strips invisible characters and collapses whitespace", () => {
    expect(cleanCommentName("  na‮na ​  x ")).toBe("nana x");
    expect(cleanCommentBody("a  \r\n\r\n\r\n\r\nb\u0007\n")).toBe("a\n\nb");
  });
  it("rejects empty and oversized text by character, not byte", async () => {
    expect(await code(post("   ", 0))).toBe("invalid_body");
    expect(await code(post("夏".repeat(1001), 0))).toBe("invalid_body");
    expect(await code(createComment(db, { thread: "site", name: "夏".repeat(25), body: "hi" }, "s", start))).toBe("invalid_name");
    expect((await post("夏".repeat(1000), 0)).body).toHaveLength(1000);
  });
  it("only opens threads for published, unarchived events", async () => {
    const event = (id: string) => code(createComment(db, { thread: `event:${id}`, name: "n", body: "hi" }, id, start));
    expect(await event("evt_live")).toBeNull();
    expect(await event("evt_draft")).toBe("thread_not_found");
    expect(await event("evt_gone")).toBe("thread_not_found");
    expect(await event("evt_missing")).toBe("thread_not_found");
  });
});

describe("posting limits", () => {
  it("spaces posts from one source and caps a short burst", async () => {
    await post("one", 0);
    expect(await code(post("two", 0.1))).toBe("rate_limited");
    for (let index = 0; index < 4; index++) await post(`more ${index}`, 1 + index);
    expect(await code(post("sixth", 6))).toBe("rate_limited");
    expect(await code(post("other source", 6, {}, "source-b"))).toBeNull();
    expect(await code(post("after the window", 15))).toBeNull();
  });
  it("refuses the same text twice in a day", async () => {
    await post("same", 0);
    expect(await code(post("same", 30))).toBe("duplicate");
  });
  it("stalls when the whole site is flooded", async () => {
    for (let index = 0; index < 120; index++) await post(`flood ${index}`, 0, {}, `bot-${index}`);
    expect(await code(post("late", 1, {}, "human"))).toBe("busy");
    expect(await code(post("late", 61, {}, "human"))).toBeNull();
  });
  it("groups an IPv6 /64 and separates IPv4 addresses", async () => {
    const hash = (address: string) => commentSourceHash("secret", address);
    expect(await hash("2001:db8:1:2:aaaa::1")).toBe(await hash("2001:0db8:0001:0002:bbbb:0:0:2"));
    expect(await hash("2001:db8:1:3::1")).not.toBe(await hash("2001:db8:1:2::1"));
    expect(await hash("203.0.113.7")).not.toBe(await hash("203.0.113.8"));
    expect(await commentSourceHash("other", "203.0.113.7")).not.toBe(await hash("203.0.113.7"));
    expect(await hash("203.0.113.7")).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("reading a thread", () => {
  it("lists newest first, nests replies and pages by cursor", async () => {
    const first = await post("first", 0);
    const second = await post("second", 1);
    const reply = await post("reply", 2, { parent_id: first.id }, "source-b");
    const nested = await post("reply to reply", 3, { parent_id: reply.id }, "source-c");
    expect(nested.parent_id).toBe(first.id);
    const page = await listComments(db, site, { limit: 1 });
    expect(page.comments.map((comment) => comment.body)).toEqual(["second"]);
    expect(page.total).toBe(4);
    expect(page.next_before).toBe(second.id);
    const rest = await listComments(db, site, { limit: 1, before: page.next_before });
    expect(rest.comments[0]!.replies.map((item) => item.body)).toEqual(["reply", "reply to reply"]);
    expect(rest.next_before).toBeNull();
    expect(rest.comments[0]).not.toHaveProperty("source_hash");
  });
  it("keeps threads apart and refuses a parent from another thread", async () => {
    const onSite = await post("site", 0);
    expect(await code(createComment(db, { thread: "event:evt_live", name: "n", body: "x", parent_id: onSite.id }, "b", start))).toBe("invalid_parent");
    expect(await code(post("x", 1, { parent_id: "1" }))).toBe("invalid_parent");
    expect((await listComments(db, { type: "event", id: "evt_live" })).total).toBe(0);
  });
});

describe("moderation", () => {
  it("hides a comment together with its replies and restores it", async () => {
    const top = await post("top", 0);
    await post("reply", 1, { parent_id: top.id }, "source-b");
    await moderateComment(db, top.id, "hide", publisher, "req-1", later(2));
    expect(await countComments(db, site)).toBe(0);
    expect(await code(post("late reply", 3, { parent_id: top.id }, "source-c"))).toBe("invalid_parent");
    await moderateComment(db, top.id, "restore", publisher, "req-2", later(4));
    expect(await countComments(db, site)).toBe(2);
    const logs = await db.prepare("SELECT action FROM audit_logs ORDER BY created_at").all<{ action: string }>();
    expect(logs.results.map((log) => log.action)).toEqual(["comment.hide", "comment.restore"]);
  });
  it("deletes with replies and keeps the removed text in the audit log", async () => {
    const top = await post("spam text", 0);
    await post("reply", 1, { parent_id: top.id }, "source-b");
    await moderateComment(db, top.id, "delete", publisher, "req", later(2));
    expect(await listAdminComments(db)).toHaveLength(0);
    const log = await db.prepare("SELECT before_json FROM audit_logs WHERE action = 'comment.delete'").first<{ before_json: string }>();
    expect(JSON.parse(log!.before_json).body).toBe("spam text");
  });
  it("blocks a source, hides what it posted and lets a moderator lift the block", async () => {
    const spam = await post("spam", 0);
    await post("more spam", 1);
    await post("fine", 1, {}, "source-b");
    await moderateComment(db, spam.id, "block", publisher, "req", later(2));
    expect((await listComments(db, site)).comments.map((comment) => comment.body)).toEqual(["fine"]);
    expect(await code(post("again", 30))).toBe("rejected");
    expect((await listCommentBlocks(db))[0]).toMatchObject({ source_hash: "source-a", comment_count: 2 });
    expect((await listAdminComments(db, { source: "source-a" })).every((comment) => comment.source_blocked === 1)).toBe(true);
    await unblockCommentSource(db, "source-a", publisher, "req-2", later(31));
    expect(await code(post("again", 32))).toBeNull();
  });
  it("rejects blocked terms across width and case, in the name too", async () => {
    await saveCommentBlockedTerms(db, [" Casino ", "casino", 7, ""], publisher, "req");
    expect(await code(post("visit ＣＡＳＩＮＯ now", 0))).toBe("rejected");
    expect(await code(createComment(db, { thread: "site", name: "casino", body: "hi" }, "s", start))).toBe("rejected");
    expect(await code(post("hello", 0))).toBeNull();
  });
  it("requires the publisher scope", async () => {
    const top = await post("top", 0);
    const reader: Actor = { ...publisher, scopes: ["events:read"] };
    await expect(moderateComment(db, top.id, "hide", reader, "req")).rejects.toThrow("events:publish");
    await expect(moderateComment(db, 999, "hide", publisher, "req")).rejects.toThrow("留言不存在");
  });
});
