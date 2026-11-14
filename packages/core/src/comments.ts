import { readSetting, writeSetting } from "./app-settings";
import type { Actor } from "./types";
import { assertScope, makeId, ServiceError } from "./utils";

/**
 * Visitor comments. Anyone can post under a nickname, so everything a visitor sends is
 * cleaned and bounded here, and every limit is enforced against the database rather than
 * trusted from the page.
 */
export const COMMENT_NAME_MAX = 24;
export const COMMENT_BODY_MAX = 1000;
export const COMMENT_PAGE_SIZE = 20;
export const COMMENT_SETTINGS_KEY = "comments.moderation";
export const COMMENT_BLOCKED_TERMS_MAX = 200;

/** Posting limits per source. The site is small; these stop floods, not conversations. */
const MIN_INTERVAL_MS = 20_000;
const SHORT_WINDOW_MS = 10 * 60_000;
const SHORT_WINDOW_MAX = 5;
const DAY_MS = 24 * 3_600_000;
const DAY_MAX = 30;
/** A ceiling across all sources, so a distributed flood stalls instead of filling the disk. */
const SITE_HOUR_MAX = 120;

export type CommentThread = { type: "site"; id: "site" } | { type: "event"; id: string };
export type CommentStatus = "visible" | "hidden";
export type CommentErrorCode =
  | "invalid_thread" | "thread_not_found" | "invalid_name" | "invalid_body" | "invalid_parent"
  | "rate_limited" | "duplicate" | "rejected" | "busy";

export class CommentError extends Error {
  constructor(readonly code: CommentErrorCode, readonly status = 400) {
    super(code);
    this.name = "CommentError";
  }
}

export interface PublicComment {
  id: number;
  name: string;
  body: string;
  created_at: string;
}
export interface PublicCommentThread extends PublicComment { replies: PublicComment[] }
export interface CommentPage {
  comments: PublicCommentThread[];
  /** Pass as `before` for the next page; null when this is the last one. */
  next_before: number | null;
  total: number;
}

export interface AdminComment {
  id: number;
  thread_type: CommentThread["type"];
  thread_id: string;
  parent_id: number | null;
  author_name: string;
  body: string;
  locale: string | null;
  status: CommentStatus;
  source_hash: string;
  created_at: string;
  moderated_at: string | null;
  moderated_by: string | null;
  event_title: string | null;
  event_slug: string | null;
  source_blocked: number;
  source_count: number;
}

export function parseCommentThread(value: unknown): CommentThread | null {
  if (value === "site") return { type: "site", id: "site" };
  const event = typeof value === "string" ? /^event:([A-Za-z0-9_-]{1,80})$/.exec(value) : null;
  return event ? { type: "event", id: event[1]! } : null;
}

export function commentThreadKey(thread: CommentThread): string {
  return thread.type === "site" ? "site" : `event:${thread.id}`;
}

// Control, zero-width and bidirectional-override characters can hide text or reorder a line.
const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;

export function cleanCommentName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

export function cleanCommentBody(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(/\r\n?/g, "\n").replace(INVISIBLE, "")
    .replace(/[^\S\n]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

const length = (value: string) => [...value].length;
const foldTerm = (value: string) => value.normalize("NFKC").toLowerCase();

/**
 * A stable, non-reversible label for where a comment came from. IPv6 senders are grouped
 * by /64 because a single device rotates freely inside its prefix.
 */
export async function commentSourceHash(secret: string, address: string): Promise<string> {
  let source = address.trim().toLowerCase();
  if (source.includes(":") && !source.includes(".")) {
    const [head = "", tail = ""] = source.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const groups = source.includes("::")
      ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
    source = groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":") + "::/64";
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`comment-source:${source}`)));
  return [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface CommentSettings { blocked_terms: string[] }

/** Reads defensively: a malformed row means "no blocked terms", never a failed post. */
export async function readCommentSettings(db: D1Database): Promise<CommentSettings> {
  const row = await readSetting(db, COMMENT_SETTINGS_KEY);
  if (!row) return { blocked_terms: [] };
  try {
    const parsed = JSON.parse(row.value) as { blocked_terms?: unknown };
    return { blocked_terms: normalizeBlockedTerms(Array.isArray(parsed.blocked_terms) ? parsed.blocked_terms : []) };
  } catch {
    return { blocked_terms: [] };
  }
}

function normalizeBlockedTerms(values: unknown[]): string[] {
  const terms = values.filter((value): value is string => typeof value === "string")
    .map((value) => value.trim()).filter((value) => value && length(value) <= 60);
  return [...new Set(terms)].slice(0, COMMENT_BLOCKED_TERMS_MAX);
}

async function threadExists(db: D1Database, thread: CommentThread): Promise<boolean> {
  if (thread.type === "site") return true;
  return Boolean(await db.prepare("SELECT 1 AS found FROM events WHERE id = ? AND published = 1 AND archived_at IS NULL")
    .bind(thread.id).first());
}

export interface CommentInput {
  thread: unknown;
  name: unknown;
  body: unknown;
  parent_id?: unknown;
  locale?: string | null;
}

export async function createComment(db: D1Database, input: CommentInput, sourceHash: string, now = new Date()): Promise<PublicComment & { parent_id: number | null }> {
  const thread = parseCommentThread(input.thread);
  if (!thread) throw new CommentError("invalid_thread");
  const name = cleanCommentName(input.name);
  if (!name || length(name) > COMMENT_NAME_MAX) throw new CommentError("invalid_name");
  const body = cleanCommentBody(input.body);
  if (!body || length(body) > COMMENT_BODY_MAX) throw new CommentError("invalid_body");
  if (!(await threadExists(db, thread))) throw new CommentError("thread_not_found", 404);

  let parentId: number | null = null;
  if (input.parent_id !== undefined && input.parent_id !== null) {
    if (!Number.isSafeInteger(input.parent_id)) throw new CommentError("invalid_parent");
    const parent = await db.prepare("SELECT id, parent_id, thread_type, thread_id, status FROM comments WHERE id = ?")
      .bind(input.parent_id as number).first<{ id: number; parent_id: number | null; thread_type: string; thread_id: string; status: string }>();
    if (!parent || parent.status !== "visible" || parent.thread_type !== thread.type || parent.thread_id !== thread.id) {
      throw new CommentError("invalid_parent");
    }
    parentId = parent.parent_id ?? parent.id;
  }

  // A blocked source and a blocked term get the same answer, so neither can be probed.
  if (await db.prepare("SELECT 1 AS found FROM comment_blocks WHERE source_hash = ?").bind(sourceHash).first()) {
    throw new CommentError("rejected", 403);
  }
  const { blocked_terms } = await readCommentSettings(db);
  const text = foldTerm(`${name}\n${body}`);
  if (blocked_terms.some((term) => text.includes(foldTerm(term)))) throw new CommentError("rejected", 403);

  const time = now.valueOf();
  const iso = (offset: number) => new Date(time - offset).toISOString();
  const recent = await db.prepare(`SELECT
      COALESCE(SUM(created_at > ?), 0) AS latest,
      COALESCE(SUM(created_at > ?), 0) AS short,
      COUNT(*) AS day,
      COALESCE(SUM(body = ?), 0) AS same
    FROM comments WHERE source_hash = ? AND created_at > ?`)
    .bind(iso(MIN_INTERVAL_MS), iso(SHORT_WINDOW_MS), body, sourceHash, iso(DAY_MS))
    .first<{ latest: number; short: number; day: number; same: number }>();
  if (recent?.same) throw new CommentError("duplicate", 409);
  if (recent && (recent.latest > 0 || recent.short >= SHORT_WINDOW_MAX || recent.day >= DAY_MAX)) {
    throw new CommentError("rate_limited", 429);
  }
  const site = await db.prepare("SELECT COUNT(*) AS total FROM comments WHERE created_at > ?").bind(iso(3_600_000)).first<{ total: number }>();
  if ((site?.total ?? 0) >= SITE_HOUR_MAX) throw new CommentError("busy", 503);

  const createdAt = now.toISOString();
  const row = await db.prepare(`INSERT INTO comments (thread_type, thread_id, parent_id, author_name, body, locale, source_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(thread.type, thread.id, parentId, name, body, input.locale ?? null, sourceHash, createdAt).first<{ id: number }>();
  return { id: row!.id, name, body, created_at: createdAt, parent_id: parentId };
}

type PublicRow = { id: number; parent_id: number | null; author_name: string; body: string; created_at: string };
const publicComment = (row: PublicRow): PublicComment => ({ id: row.id, name: row.author_name, body: row.body, created_at: row.created_at });

/** Newest conversations first; replies inside one read oldest first. */
export async function listComments(db: D1Database, thread: CommentThread, options: { before?: number | null; limit?: number } = {}): Promise<CommentPage> {
  const limit = Math.min(Math.max(1, options.limit ?? COMMENT_PAGE_SIZE), 50);
  const before = options.before && Number.isSafeInteger(options.before) ? options.before : Number.MAX_SAFE_INTEGER;
  const top = await db.prepare(`SELECT id, parent_id, author_name, body, created_at FROM comments
    WHERE thread_type = ? AND thread_id = ? AND status = 'visible' AND parent_id IS NULL AND id < ?
    ORDER BY id DESC LIMIT ?`).bind(thread.type, thread.id, before, limit + 1).all<PublicRow>();
  const rows = top.results.slice(0, limit);
  const replies = new Map<number, PublicComment[]>();
  if (rows.length) {
    const children = await db.prepare(`SELECT id, parent_id, author_name, body, created_at FROM comments
      WHERE status = 'visible' AND parent_id IN (${rows.map(() => "?").join(",")}) ORDER BY id`)
      .bind(...rows.map((row) => row.id)).all<PublicRow>();
    for (const child of children.results) {
      const list = replies.get(child.parent_id!) ?? [];
      list.push(publicComment(child));
      replies.set(child.parent_id!, list);
    }
  }
  return {
    comments: rows.map((row) => ({ ...publicComment(row), replies: replies.get(row.id) ?? [] })),
    next_before: top.results.length > limit ? rows.at(-1)!.id : null,
    total: await countComments(db, thread),
  };
}

/** Counts what a reader can actually see: a reply under a hidden comment is hidden with it. */
export async function countComments(db: D1Database, thread: CommentThread): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS total FROM comments c
    LEFT JOIN comments p ON p.id = c.parent_id
    WHERE c.thread_type = ? AND c.thread_id = ? AND c.status = 'visible' AND (c.parent_id IS NULL OR p.status = 'visible')`)
    .bind(thread.type, thread.id).first<{ total: number }>();
  return row?.total ?? 0;
}

export interface AdminCommentFilters { status?: CommentStatus; query?: string; source?: string }

function adminWhere(filters: AdminCommentFilters): { where: string; bindings: unknown[] } {
  const clauses: string[] = [], bindings: unknown[] = [];
  if (filters.status) { clauses.push("c.status = ?"); bindings.push(filters.status); }
  if (filters.source) { clauses.push("c.source_hash = ?"); bindings.push(filters.source); }
  if (filters.query) {
    const like = `%${filters.query.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push("(c.author_name LIKE ? ESCAPE '\\' OR c.body LIKE ? ESCAPE '\\')");
    bindings.push(like, like);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", bindings };
}

export async function listAdminComments(db: D1Database, filters: AdminCommentFilters = {}, limit = 50, offset = 0): Promise<AdminComment[]> {
  const { where, bindings } = adminWhere(filters);
  const result = await db.prepare(`SELECT c.*, e.title AS event_title, e.slug AS event_slug,
      EXISTS(SELECT 1 FROM comment_blocks b WHERE b.source_hash = c.source_hash) AS source_blocked,
      (SELECT COUNT(*) FROM comments o WHERE o.source_hash = c.source_hash) AS source_count
    FROM comments c LEFT JOIN events e ON c.thread_type = 'event' AND e.id = c.thread_id
    ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`).bind(...bindings, limit, offset).all<AdminComment>();
  return result.results;
}

export async function countAdminComments(db: D1Database, filters: AdminCommentFilters = {}): Promise<number> {
  const { where, bindings } = adminWhere(filters);
  const row = await db.prepare(`SELECT COUNT(*) AS total FROM comments c ${where}`).bind(...bindings).first<{ total: number }>();
  return row?.total ?? 0;
}

export async function listCommentBlocks(db: D1Database): Promise<Array<{ source_hash: string; created_at: string; created_by: string; comment_count: number }>> {
  const result = await db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM comments c WHERE c.source_hash = b.source_hash) AS comment_count
    FROM comment_blocks b ORDER BY b.created_at DESC LIMIT 200`).all<{ source_hash: string; created_at: string; created_by: string; comment_count: number }>();
  return result.results;
}

function audit(db: D1Database, actor: Actor, requestId: string, action: string, targetType: string, targetId: string, before: unknown, after: unknown, createdAt: string): D1PreparedStatement {
  return db.prepare(`INSERT INTO audit_logs (id, actor_id, actor_type, channel, action, target_type, target_id, request_id, before_json, after_json, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
    .bind(makeId("aud"), actor.id, actor.type, actor.channel, action, targetType, targetId, requestId,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, createdAt);
}

export type CommentModeration = "hide" | "restore" | "delete" | "block";

/**
 * Moderation is a publisher action and always leaves an audit entry. The entry keeps the
 * author and text of what was removed, so a deletion can still be reviewed afterwards.
 */
export async function moderateComment(db: D1Database, id: number, action: CommentModeration, actor: Actor, requestId: string, now = new Date()): Promise<void> {
  assertScope(actor, "events:publish");
  const comment = await db.prepare("SELECT id, thread_type, thread_id, parent_id, author_name, body, status, source_hash, created_at FROM comments WHERE id = ?")
    .bind(id).first<Record<string, unknown> & { status: CommentStatus; source_hash: string }>();
  if (!comment) throw new ServiceError("not_found", "留言不存在或已删除", 404);
  const at = now.toISOString(), target = String(id);
  if (action === "delete") {
    await db.batch([
      db.prepare("DELETE FROM comments WHERE parent_id = ?").bind(id),
      db.prepare("DELETE FROM comments WHERE id = ?").bind(id),
      audit(db, actor, requestId, "comment.delete", "comment", target, comment, null, at),
    ]);
  } else if (action === "block") {
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO comment_blocks (source_hash, created_at, created_by) VALUES (?, ?, ?)").bind(comment.source_hash, at, actor.id),
      db.prepare("UPDATE comments SET status = 'hidden', moderated_at = ?, moderated_by = ? WHERE source_hash = ? AND status = 'visible'")
        .bind(at, actor.id, comment.source_hash),
      audit(db, actor, requestId, "comment.block", "comment", target, comment, { source_hash: comment.source_hash }, at),
    ]);
  } else {
    const status: CommentStatus = action === "hide" ? "hidden" : "visible";
    if (comment.status === status) return;
    await db.batch([
      db.prepare("UPDATE comments SET status = ?, moderated_at = ?, moderated_by = ? WHERE id = ?").bind(status, at, actor.id, id),
      audit(db, actor, requestId, `comment.${action}`, "comment", target, comment, { status }, at),
    ]);
  }
}

/** Lifting a block lets the source post again; comments hidden by the block stay hidden. */
export async function unblockCommentSource(db: D1Database, sourceHash: string, actor: Actor, requestId: string, now = new Date()): Promise<void> {
  assertScope(actor, "events:publish");
  await db.batch([
    db.prepare("DELETE FROM comment_blocks WHERE source_hash = ?").bind(sourceHash),
    audit(db, actor, requestId, "comment.unblock", "comment_source", sourceHash, { source_hash: sourceHash }, null, now.toISOString()),
  ]);
}

export async function saveCommentBlockedTerms(db: D1Database, terms: unknown[], actor: Actor, requestId: string, now = new Date()): Promise<CommentSettings> {
  assertScope(actor, "events:publish");
  const before = await readCommentSettings(db);
  const settings: CommentSettings = { blocked_terms: normalizeBlockedTerms(terms) };
  await writeSetting(db, COMMENT_SETTINGS_KEY, settings, actor.id, now);
  await audit(db, actor, requestId, "comment.settings", "comment_settings", COMMENT_SETTINGS_KEY, before, settings, now.toISOString()).run();
  return settings;
}
