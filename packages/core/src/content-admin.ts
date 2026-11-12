import { COVER_PATH_PATTERN } from "./release-media";
import { z } from "zod";
import { getAdminReleaseById, getAdminSetlistById, getAdminSongById } from "./music-admin-repository";
import { songPhaseMask } from "./music-types";
import type {
  AdminReleaseDetail,
  AdminSetlistDetail,
  AdminSongDetail,
  ReleaseType,
  SetlistCompleteness,
  SetlistConfidence,
  SetlistSection,
} from "./music-types";
import { getEventById, requireEvent } from "./repository";
import { getTourById, type TourDetail } from "./tours";
import { prepareEventLocation, replaceEventLocationStatements } from "./locations";
import { dateSchema, eventDraftSchema, sourceInputSchema, type EventDraft } from "./schema";
import type { Actor, EventRecord } from "./types";
import { assertScope, createEventSlug, makeId, normalizeForDuplicate, ServiceError, slugify } from "./utils";

const idempotencyKeySchema = z.string().trim().min(8).max(200);
const optionalIdSchema = z.string().trim().min(1).max(160).optional();
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((value) => value || null);
const slugSchema = z.string().trim().min(3).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug 只能包含小写字母、数字和连字符");
const catalogSourceSchema = sourceInputSchema;
const storedCoverUrl = optionalText(2048).refine((value) => !value || COVER_PATH_PATTERN.test(value), "请先将封面导入本站图片库").optional();
const officialCoverSource = optionalText(2048).refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.origin === "https://fripside.net" && !url.username && !url.password
      && /^\/musics\/\d+\/?$/.test(url.pathname);
  } catch { return false; }
}, "来源须使用 fripSide 官网发行页面").optional();

const songVersionSaveSchema = z.object({
  id: optionalIdSchema,
  slug: slugSchema.optional(),
  title: z.string().trim().min(1).max(240),
  version_label: optionalText(160),
  artist_credit: z.string().trim().min(1).max(240),
  release_date: dateSchema.nullish(),
  notes: optionalText(4000),
  published: z.boolean(),
  sources: z.array(catalogSourceSchema).max(10),
});

export const songSaveSchema = z.object({
  id: optionalIdSchema,
  expected_updated_at: z.string().trim().min(1).optional(),
  idempotency_key: idempotencyKeySchema,
  slug: slugSchema.optional(),
  title: z.string().trim().min(1).max(240),
  original_artist: z.string().trim().min(1).max(240),
  first_release_date: dateSchema.nullish(),
  // Omitted keeps the stored phases, so callers that predate the field cannot clear them; [] clears.
  phases: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).max(3).optional(),
  notes: optionalText(4000),
  published: z.boolean(),
  aliases: z.array(z.string().trim().min(1).max(240)).max(80),
  sources: z.array(catalogSourceSchema).max(10),
  versions: z.array(songVersionSaveSchema).min(1, "每首歌曲至少需要一个歌曲版本").max(50),
}).superRefine((input, context) => {
  if (input.id && !input.expected_updated_at) {
    context.addIssue({ code: "custom", path: ["expected_updated_at"], message: "编辑歌曲时缺少并发校验值" });
  }
  const aliases = new Set<string>();
  for (const [index, alias] of input.aliases.entries()) {
    const normalized = normalizeForDuplicate(alias);
    if (aliases.has(normalized)) context.addIssue({ code: "custom", path: ["aliases", index], message: "别名重复" });
    aliases.add(normalized);
  }
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const [index, version] of input.versions.entries()) {
    if (version.id) {
      if (ids.has(version.id)) context.addIssue({ code: "custom", path: ["versions", index, "id"], message: "歌曲版本重复" });
      ids.add(version.id);
    }
    if (version.slug) {
      if (slugs.has(version.slug)) context.addIssue({ code: "custom", path: ["versions", index, "slug"], message: "版本 slug 重复" });
      slugs.add(version.slug);
    }
  }
});

/** Admin-only display fields; omitted keeps the stored values (MCP proposals never send them). */
const eventDisplaySchema = z.object({
  alias: z.string().trim().max(240).nullish(),
  tour_id: z.string().trim().min(1).max(160).nullish(),
  tour_stop: z.string().trim().max(120).nullish(),
});

export const directEventSaveSchema = z.object({
  id: optionalIdSchema,
  expected_version: z.number().int().positive().optional(),
  published: z.boolean(),
  idempotency_key: idempotencyKeySchema,
  event: eventDraftSchema,
  display: eventDisplaySchema.optional(),
}).superRefine((input, context) => {
  if (input.id && !input.expected_version) {
    context.addIssue({ code: "custom", path: ["expected_version"], message: "编辑活动时缺少版本号" });
  }
});

export const tourSaveSchema = z.object({
  id: optionalIdSchema,
  expected_updated_at: z.string().trim().min(1).optional(),
  idempotency_key: idempotencyKeySchema,
  slug: slugSchema.optional(),
  name: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(2000).nullish(),
  published: z.boolean(),
}).superRefine((input, context) => {
  if (input.id && !input.expected_updated_at) context.addIssue({ code: "custom", path: ["expected_updated_at"], message: "编辑巡演时缺少并发校验值" });
});

const tourStopIdsSchema = z.array(z.string().trim().min(1).max(160)).max(200).default([]);

/** Bulk membership edit from the tour page: add events to the tour and/or remove its current stops. */
export const tourStopsUpdateSchema = z.object({
  tour_id: z.string().trim().min(1).max(160),
  idempotency_key: idempotencyKeySchema,
  add_event_ids: tourStopIdsSchema,
  remove_event_ids: tourStopIdsSchema,
}).superRefine((input, context) => {
  if (!input.add_event_ids.length && !input.remove_event_ids.length) {
    context.addIssue({ code: "custom", path: ["add_event_ids"], message: "请至少选择一场活动" });
  }
  const removing = new Set(input.remove_event_ids);
  if (input.add_event_ids.some((id) => removing.has(id))) {
    context.addIssue({ code: "custom", path: ["remove_event_ids"], message: "同一场活动不能同时加入和移出" });
  }
});

export const eventArchiveSchema = z.object({
  id: z.string().trim().min(1).max(160),
  expected_version: z.number().int().positive(),
  archived: z.boolean(),
  idempotency_key: idempotencyKeySchema,
});

const appleMusicIdSchema = z.string().regex(/^\d{1,20}$/, "Apple Music ID 应为数字");
const youTubeIdSchema = z.string().regex(/^[\w-]{11}$/, "YouTube 视频 ID 格式不正确");

const releaseTrackSchema = z.object({
  song_version_id: z.string().trim().min(1).max(160),
  disc_number: z.number().int().min(1).max(99),
  track_number: z.number().int().min(1).max(999),
  display_title: z.string().trim().min(1).max(240),
  notes: optionalText(1000),
  // Streaming ids: undefined keeps the value already stored for this disc/track slot, null clears it.
  apple_music_track_id: appleMusicIdSchema.nullish(),
  youtube_video_id: youTubeIdSchema.nullish(),
});

export const releaseSaveSchema = z.object({
  cover_url: storedCoverUrl,
  cover_source_url: officialCoverSource,
  id: optionalIdSchema,
  expected_updated_at: z.string().trim().min(1).optional(),
  idempotency_key: idempotencyKeySchema,
  slug: slugSchema.optional(),
  title: z.string().trim().min(1).max(240),
  release_type: z.enum(["album", "single", "ep", "compilation", "video", "other"]),
  release_date: dateSchema.nullish(),
  catalog_number: optionalText(120),
  edition: optionalText(160),
  notes: optionalText(4000),
  published: z.boolean(),
  sources: z.array(catalogSourceSchema).max(10),
  tracks: z.array(releaseTrackSchema).max(80),
  // Search aliases (Chinese/English titles, nicknames). Omitted keeps the stored aliases; [] clears them.
  aliases: z.array(z.string().trim().min(1).max(240)).max(80).optional(),
  // undefined keeps the stored album id, null clears it.
  apple_music_album_id: appleMusicIdSchema.nullish(),
  apple_music_storefront: z.string().regex(/^[a-z]{2}$/).nullish(),
}).superRefine((input, context) => {
  if (input.id && !input.expected_updated_at) {
    context.addIssue({ code: "custom", path: ["expected_updated_at"], message: "编辑专辑时缺少并发校验值" });
  }
  const slots = new Set<string>();
  for (const [index, track] of input.tracks.entries()) {
    const slot = `${track.disc_number}:${track.track_number}`;
    if (slots.has(slot)) context.addIssue({ code: "custom", path: ["tracks", index], message: `Disc ${track.disc_number} Track ${track.track_number} 重复` });
    slots.add(slot);
  }
  const aliases = new Set<string>();
  for (const [index, alias] of (input.aliases ?? []).entries()) {
    const normalized = normalizeForDuplicate(alias);
    if (aliases.has(normalized)) context.addIssue({ code: "custom", path: ["aliases", index], message: "别名重复" });
    aliases.add(normalized);
  }
});

const setlistEntrySchema = z.object({
  song_id: z.string().trim().min(1).max(160),
  performed_version_id: optionalText(160),
  section: z.enum(["main", "encore", "double_encore", "opening", "other"]),
  display_title: optionalText(240),
  medley_group: optionalText(40),
  notes: optionalText(1000),
});

export const setlistSaveSchema = z.object({
  id: optionalIdSchema,
  expected_updated_at: z.string().trim().min(1).optional(),
  idempotency_key: idempotencyKeySchema,
  event_id: z.string().trim().min(1).max(160),
  performance_label: z.string().trim().min(1).max(160),
  // Omitted (undefined) keeps the stored title; the admin form no longer sends it.
  title: z.string().trim().max(240).nullish().transform((value) => value === undefined ? undefined : value || null),
  completeness: z.enum(["complete", "partial", "unknown"]),
  confidence: z.enum(["official", "reported", "unverified"]),
  notes: optionalText(4000),
  published: z.boolean(),
  sources: z.array(catalogSourceSchema).max(10),
  entries: z.array(setlistEntrySchema).max(80),
}).superRefine((input, context) => {
  if (input.id && !input.expected_updated_at) {
    context.addIssue({ code: "custom", path: ["expected_updated_at"], message: "编辑 Setlist 时缺少并发校验值" });
  }
});

export type DirectEventSaveInput = z.infer<typeof directEventSaveSchema>;
export type TourSaveInput = z.infer<typeof tourSaveSchema>;
export type TourStopsUpdateInput = z.input<typeof tourStopsUpdateSchema>;
export interface TourStopsUpdateResult { tour: TourDetail; added: number; removed: number }
export type SongSaveInput = z.infer<typeof songSaveSchema>;
export type ReleaseSaveInput = z.infer<typeof releaseSaveSchema>;
export type SetlistSaveInput = z.infer<typeof setlistSaveSchema>;

function cleanNullable(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function nextUpdatedAt(previous?: string | null): string {
  const current = Date.now();
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  return new Date(Number.isFinite(previousTime) ? Math.max(current, previousTime + 1) : current).toISOString();
}

function catalogSlug(kind: "song" | "version" | "release" | "setlist", title: string, id: string): string {
  return slugify(title) || `${kind}-${id.slice(-10).toLowerCase()}`;
}

function normalizedEvent(input: EventDraft, id: string, existing?: EventRecord | null): Omit<EventDraft, "slug"> & { slug: string } {
  return {
    ...input,
    slug: input.slug ?? existing?.slug ?? createEventSlug(input.start_date, input.title, id),
    end_date: cleanNullable(input.end_date),
    start_time: cleanNullable(input.start_time),
    end_time: cleanNullable(input.end_time),
    classification: cleanNullable(input.classification),
    location_note: cleanNullable(input.location_note),
    remark: cleanNullable(input.remark),
  };
}

function auditStatement(
  db: D1Database,
  actor: Actor,
  requestId: string,
  action: string,
  targetType: string,
  targetId: string,
  before: unknown,
  after: unknown,
  createdAt: string,
  conditionSql: string,
  conditionBindings: unknown[],
): D1PreparedStatement {
  return db.prepare(`INSERT INTO audit_logs (
    id, actor_id, actor_type, channel, action, target_type, target_id, request_id,
    before_json, after_json, metadata_json, created_at
  ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ? WHERE ${conditionSql}`)
    .bind(
      makeId("aud"), actor.id, actor.type, actor.channel, action, targetType, targetId, requestId,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, createdAt,
      ...conditionBindings,
    );
}

async function receiptTarget(db: D1Database, key: string, operation: string): Promise<string | null> {
  const row = await db.prepare("SELECT result_json FROM operation_receipts WHERE idempotency_key = ? AND operation = ?")
    .bind(key, operation)
    .first<{ result_json: string }>();
  if (!row) return null;
  try {
    const result = JSON.parse(row.result_json) as { target_id?: unknown };
    return typeof result.target_id === "string" ? result.target_id : null;
  } catch {
    return null;
  }
}

function receiptStatement(
  db: D1Database,
  key: string,
  operation: string,
  targetId: string,
  createdAt: string,
  conditionSql: string,
  conditionBindings: unknown[],
): D1PreparedStatement {
  return db.prepare(`INSERT INTO operation_receipts (idempotency_key, operation, result_json, created_at)
    SELECT ?, ?, ?, ? WHERE ${conditionSql}`)
    .bind(key, operation, JSON.stringify({ target_id: targetId }), createdAt, ...conditionBindings);
}

function sourceInsertStatement(
  db: D1Database,
  subjectType: "song" | "version" | "release" | "setlist",
  subjectId: string,
  source: z.infer<typeof catalogSourceSchema>,
  actor: Actor,
  createdAt: string,
  conditionSql: string,
  conditionBindings: unknown[],
): D1PreparedStatement {
  return db.prepare(`INSERT INTO catalog_sources (
    id, subject_type, subject_id, url, label, source_type, verified_at, created_at, created_by
  ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${conditionSql}`)
    .bind(
      makeId("mus_src"), subjectType, subjectId, source.url, source.label ?? null,
      source.source_type ?? "official", createdAt, createdAt, actor.id,
      ...conditionBindings,
    );
}

export class ContentAdminService {
  constructor(private readonly db: D1Database) {}

  async saveEvent(raw: unknown, actor: Actor, requestId = makeId("req")): Promise<EventRecord> {
    assertScope(actor, "events:publish");
    const input = directEventSaveSchema.parse(raw);
    const receiptId = await receiptTarget(this.db, input.idempotency_key, "admin.event.save");
    if (receiptId) return requireEvent(this.db, receiptId);

    const existing = input.id ? await requireEvent(this.db, input.id) : null;
    if (existing && existing.version !== input.expected_version) {
      throw new ServiceError("version_conflict", `活动当前为 v${existing.version}，页面基于 v${input.expected_version}`, 409);
    }
    const id = existing?.id ?? makeId("evt");
    const event = normalizedEvent(input.event, id, existing);
    const display = input.display ? {
      alias: cleanNullable(input.display.alias),
      tour_id: cleanNullable(input.display.tour_id),
      tour_stop: cleanNullable(input.display.tour_stop),
    } : null;
    if (display?.tour_id && !await this.db.prepare("SELECT 1 FROM tours WHERE id = ?").bind(display.tour_id).first()) {
      throw new ServiceError("validation_error", "所选巡演不存在", 400);
    }
    const location = prepareEventLocation(event);
    const now = nextUpdatedAt(existing?.updated_at);
    const conditionSql = "EXISTS (SELECT 1 FROM events WHERE id = ? AND updated_at = ?)";
    const conditionBindings = [id, now];
    const statements: D1PreparedStatement[] = [];

    if (existing) {
      statements.push(this.db.prepare(`UPDATE events SET
        slug = ?, title = ?, start_date = ?, end_date = ?, start_time = ?, end_time = ?, timezone = ?,
        category = ?, classification = ?, location_mode = ?, location_note = ?, remark = ?, status = ?, published = ?,
        alias = CASE WHEN ? THEN ? ELSE alias END, tour_id = CASE WHEN ? THEN ? ELSE tour_id END,
        tour_stop = CASE WHEN ? THEN ? ELSE tour_stop END,
        version = version + 1, updated_at = ?,
        published_at = CASE WHEN ? = 1 AND published_at IS NULL THEN ? ELSE published_at END
        WHERE id = ? AND version = ? AND updated_at = ?`)
        .bind(
          event.slug, event.title, event.start_date, event.end_date, event.start_time, event.end_time, event.timezone,
          event.category, event.classification, event.location_mode, event.location_note, event.remark, event.status,
          input.published ? 1 : 0,
          display ? 1 : 0, display?.alias ?? null, display ? 1 : 0, display?.tour_id ?? null, display ? 1 : 0, display?.tour_stop ?? null,
          now, input.published ? 1 : 0, now, id, existing.version, existing.updated_at,
        ));
    } else {
      statements.push(this.db.prepare(`INSERT INTO events (
        id, slug, title, start_date, end_date, start_time, end_time, timezone, category,
        classification, location_mode, location_note, remark, status, published, alias, tour_id, tour_stop,
        version, created_at, updated_at, published_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)`)
        .bind(
          id, event.slug, event.title, event.start_date, event.end_date, event.start_time, event.end_time,
          event.timezone, event.category, event.classification, event.location_mode, event.location_note, event.remark,
          event.status, input.published ? 1 : 0, display?.alias ?? null, display?.tour_id ?? null, display?.tour_stop ?? null,
          now, now, input.published ? now : null,
        ));
    }

    statements.push(...replaceEventLocationStatements(this.db, id, location, now, conditionSql, conditionBindings));

    statements.push(this.db.prepare(`DELETE FROM event_sources
      WHERE event_id = ? AND ${conditionSql}`).bind(id, ...conditionBindings));
    for (const source of event.sources) {
      statements.push(this.db.prepare(`INSERT INTO event_sources (
        id, event_id, url, label, source_type, verified_at, created_at, created_by
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${conditionSql}`)
        .bind(
          makeId("src"), id, source.url, source.label ?? null, source.source_type ?? "official",
          now, now, actor.id, ...conditionBindings,
        ));
    }
    const after = { ...event, id, published: input.published, ...(display ?? {}) };
    statements.push(
      auditStatement(this.db, actor, requestId, existing ? "content.event.update" : "content.event.create", "event", id, existing, after, now, conditionSql, conditionBindings),
      receiptStatement(this.db, input.idempotency_key, "admin.event.save", id, now, conditionSql, conditionBindings),
    );
    const results = await this.db.batch(statements);
    if ((results[0].meta.changes ?? 0) !== 1) throw new ServiceError("version_conflict", "活动在保存前已发生变化，请刷新页面", 409);
    return requireEvent(this.db, id);
  }

  async saveTour(raw: unknown, actor: Actor, requestId = makeId("req")): Promise<TourDetail> {
    assertScope(actor, "events:publish");
    const input = tourSaveSchema.parse(raw);
    const receiptId = await receiptTarget(this.db, input.idempotency_key, "admin.tour.save");
    if (receiptId) return (await getTourById(this.db, receiptId))!;
    const before = input.id ? await getTourById(this.db, input.id) : null;
    if (input.id && !before) throw new ServiceError("not_found", "巡演不存在", 404);
    if (before && before.updated_at !== input.expected_updated_at) throw new ServiceError("version_conflict", "巡演已经被修改，请刷新页面", 409);
    const id = before?.id ?? makeId("tour");
    const slug = input.slug ?? before?.slug ?? (slugify(input.name) || `tour-${id.slice(-10).toLowerCase()}`);
    const clash = await this.db.prepare("SELECT id FROM tours WHERE slug = ? AND id <> ?").bind(slug, id).first<{ id: string }>();
    if (clash) throw new ServiceError("duplicate_slug", "slug 已被其他巡演使用", 409);
    const now = nextUpdatedAt(before?.updated_at);
    const notes = cleanNullable(input.notes);
    const conditionSql = "EXISTS (SELECT 1 FROM tours WHERE id = ? AND updated_at = ?)";
    const conditionBindings = [id, now];
    const write = before
      ? this.db.prepare("UPDATE tours SET slug = ?, name = ?, notes = ?, published = ?, updated_at = ? WHERE id = ? AND updated_at = ?")
        .bind(slug, input.name, notes, input.published ? 1 : 0, now, id, before.updated_at)
      : this.db.prepare("INSERT INTO tours (id, slug, name, notes, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, slug, input.name, notes, input.published ? 1 : 0, now, now);
    const after = { id, slug, name: input.name, notes, published: input.published };
    const results = await this.db.batch([
      write,
      auditStatement(this.db, actor, requestId, before ? "content.tour.update" : "content.tour.create", "tour", id,
        before ? { id: before.id, slug: before.slug, name: before.name, notes: before.notes, published: before.published } : null, after, now, conditionSql, conditionBindings),
      receiptStatement(this.db, input.idempotency_key, "admin.tour.save", id, now, conditionSql, conditionBindings),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) throw new ServiceError("version_conflict", "巡演在保存前已发生变化，请刷新页面", 409);
    return (await getTourById(this.db, id))!;
  }

  /**
   * Adds events to a tour and removes current stops in one batch. Each changed event gets a version bump and an
   * audit row, exactly like saving it from the event editor. Moving an event out of a tour (to another one or to
   * none) clears its tour-specific stop label; adding an unassigned event keeps whatever label it already has.
   */
  async updateTourStops(raw: unknown, actor: Actor, requestId = makeId("req")): Promise<TourStopsUpdateResult> {
    assertScope(actor, "events:publish");
    const input = tourStopsUpdateSchema.parse(raw);
    const receiptId = await receiptTarget(this.db, input.idempotency_key, "admin.tour.stops");
    if (receiptId) return { tour: (await getTourById(this.db, receiptId))!, added: 0, removed: 0 };
    const tour = await getTourById(this.db, input.tour_id);
    if (!tour) throw new ServiceError("not_found", "巡演不存在", 404);

    const addIds = [...new Set(input.add_event_ids)];
    const removeIds = [...new Set(input.remove_event_ids)];
    const ids = [...addIds, ...removeIds];
    const rows = (await this.db.prepare(`SELECT id, title, tour_id, tour_stop, version, updated_at, archived_at
      FROM events WHERE id IN (${ids.map(() => "?").join(", ")})`).bind(...ids)
      .all<{ id: string; title: string; tour_id: string | null; tour_stop: string | null; version: number; updated_at: string; archived_at: string | null }>()).results;
    const byId = new Map(rows.map((row) => [row.id, row]));

    const changes: Array<{ row: (typeof rows)[number]; tour_id: string | null; tour_stop: string | null }> = [];
    for (const id of addIds) {
      const row = byId.get(id);
      if (!row || row.archived_at) throw new ServiceError("validation_error", "所选活动不存在或已归档，请刷新页面", 400);
      if (row.tour_id === tour.id) continue;
      changes.push({ row, tour_id: tour.id, tour_stop: row.tour_id ? null : row.tour_stop });
    }
    for (const id of removeIds) {
      const row = byId.get(id);
      if (!row) throw new ServiceError("validation_error", "要移出的活动不存在，请刷新页面", 400);
      if (row.tour_id !== tour.id) continue;
      changes.push({ row, tour_id: null, tour_stop: null });
    }
    if (!changes.length) return { tour, added: 0, removed: 0 };

    const statements: D1PreparedStatement[] = [];
    let receiptCondition: { sql: string; bindings: unknown[]; now: string } | null = null;
    for (const change of changes) {
      const { row } = change;
      const now = nextUpdatedAt(row.updated_at);
      const conditionSql = "EXISTS (SELECT 1 FROM events WHERE id = ? AND updated_at = ?)";
      const conditionBindings = [row.id, now];
      receiptCondition ??= { sql: conditionSql, bindings: conditionBindings, now };
      statements.push(
        this.db.prepare(`UPDATE events SET tour_id = ?, tour_stop = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ? AND updated_at = ? AND archived_at IS NULL`)
          .bind(change.tour_id, change.tour_stop, now, row.id, row.version, row.updated_at),
        auditStatement(this.db, actor, requestId, "content.event.tour", "event", row.id,
          { id: row.id, title: row.title, tour_id: row.tour_id, tour_stop: row.tour_stop },
          { id: row.id, title: row.title, tour_id: change.tour_id, tour_stop: change.tour_stop },
          now, conditionSql, conditionBindings),
      );
    }
    statements.push(receiptStatement(this.db, input.idempotency_key, "admin.tour.stops", tour.id, receiptCondition!.now, receiptCondition!.sql, receiptCondition!.bindings));
    const results = await this.db.batch(statements);
    const failed = changes.filter((_, index) => (results[index * 2].meta.changes ?? 0) !== 1);
    if (failed.length) {
      throw new ServiceError("version_conflict", `以下活动在保存前已发生变化，请刷新页面后重试：${failed.map((change) => change.row.title).join("、")}`, 409);
    }
    const added = changes.filter((change) => change.tour_id === tour.id).length;
    return { tour: (await getTourById(this.db, tour.id))!, added, removed: changes.length - added };
  }

  async setEventArchived(raw: unknown, actor: Actor, requestId = makeId("req")): Promise<EventRecord> {
    assertScope(actor, "events:archive");
    const input = eventArchiveSchema.parse(raw);
    const receiptId = await receiptTarget(this.db, input.idempotency_key, "admin.event.archive");
    if (receiptId) return requireEvent(this.db, receiptId);
    const before = await requireEvent(this.db, input.id);
    if (before.version !== input.expected_version) throw new ServiceError("version_conflict", "活动版本已经变化，请刷新页面", 409);
    const now = nextUpdatedAt(before.updated_at);
    const archivedAt = input.archived ? now : null;
    const conditionSql = "EXISTS (SELECT 1 FROM events WHERE id = ? AND updated_at = ?)";
    const conditionBindings = [before.id, now];
    const results = await this.db.batch([
      this.db.prepare(`UPDATE events SET archived_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ? AND updated_at = ?`)
        .bind(archivedAt, now, before.id, before.version, before.updated_at),
      auditStatement(this.db, actor, requestId, input.archived ? "content.event.archive" : "content.event.restore", "event", before.id, before, { ...before, archived_at: archivedAt }, now, conditionSql, conditionBindings),
      receiptStatement(this.db, input.idempotency_key, "admin.event.archive", before.id, now, conditionSql, conditionBindings),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) throw new ServiceError("version_conflict", "活动在操作前已发生变化，请刷新页面", 409);
    return requireEvent(this.db, before.id);
  }

  async saveSong(raw: unknown, actor: Actor, requestId = makeId("req")): Promise<AdminSongDetail> {
    assertScope(actor, "music:write");
    const input = songSaveSchema.parse(raw);
    const receiptId = await receiptTarget(this.db, input.idempotency_key, "admin.song.save");
    if (receiptId) {
      const receiptSong = await getAdminSongById(this.db, receiptId);
      if (receiptSong) return receiptSong;
    }

    const before = input.id ? await getAdminSongById(this.db, input.id) : null;
    if (input.id && !before) throw new ServiceError("not_found", "没有找到歌曲", 404);
    if (before && before.updated_at !== input.expected_updated_at) throw new ServiceError("version_conflict", "歌曲已经被修改，请刷新页面", 409);

    const submittedVersionIds = new Set(input.versions.flatMap((version) => version.id ? [version.id] : []));
    const missingVersions = before?.versions.filter((version) => !submittedVersionIds.has(version.id)) ?? [];
    if (missingVersions.length) {
      throw new ServiceError("version_removal_not_supported", `请保留已有歌曲版本：${missingVersions.map((version) => version.title).join("、")}`, 400);
    }
    const foreignVersion = input.versions.find((version) => version.id && !before?.versions.some((existing) => existing.id === version.id));
    if (foreignVersion) throw new ServiceError("invalid_version", "提交的歌曲版本不属于当前歌曲", 400);

    const id = before?.id ?? makeId("mus_song");
    const slug = input.slug ?? before?.slug ?? catalogSlug("song", input.title, id);
    const versionRecords = input.versions.map((version, index) => {
      const versionId = version.id ?? makeId("mus_version");
      const existing = before?.versions.find((item) => item.id === version.id);
      const slugTitle = version.version_label ? `${slug}-${version.version_label}` : index === 0 ? slug : version.title;
      return {
        ...version,
        id: versionId,
        slug: version.slug ?? existing?.slug ?? catalogSlug("version", slugTitle, versionId),
        existing,
      };
    });
    if (new Set(versionRecords.map((version) => version.slug)).size !== versionRecords.length) {
      throw new ServiceError("duplicate_slug", "同一表单中的歌曲版本 slug 不能重复", 409);
    }
    await this.validateSongSlugs(id, slug, versionRecords.map((version) => ({ id: version.id, slug: version.slug })));

    const now = nextUpdatedAt(before?.updated_at);
    const conditionSql = "EXISTS (SELECT 1 FROM songs WHERE id = ? AND updated_at = ?)";
    const conditionBindings = [id, now];
    const statements: D1PreparedStatement[] = [];
    if (before) {
      statements.push(this.db.prepare(`UPDATE songs SET slug = ?, title = ?, normalized_title = ?, original_artist = ?,
        first_release_date = ?, phase_mask = CASE WHEN ? THEN ? ELSE phase_mask END, notes = ?, published = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?`)
        .bind(slug, input.title, normalizeForDuplicate(input.title), input.original_artist, input.first_release_date ?? null,
          input.phases === undefined ? 0 : 1, songPhaseMask(input.phases ?? []),
          input.notes, input.published ? 1 : 0, now, id, before.updated_at));
    } else {
      statements.push(this.db.prepare(`INSERT INTO songs (
        id, slug, title, normalized_title, original_artist, first_release_date, phase_mask, notes, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, slug, input.title, normalizeForDuplicate(input.title), input.original_artist, input.first_release_date ?? null,
          songPhaseMask(input.phases ?? []), input.notes, input.published ? 1 : 0, now, now));
    }

    statements.push(
      this.db.prepare(`DELETE FROM song_aliases WHERE song_id = ? AND ${conditionSql}`).bind(id, ...conditionBindings),
      this.db.prepare(`DELETE FROM catalog_sources WHERE subject_type = 'song' AND subject_id = ? AND ${conditionSql}`).bind(id, ...conditionBindings),
    );
    for (const alias of input.aliases) {
      statements.push(this.db.prepare(`INSERT INTO song_aliases (id, song_id, alias, normalized_alias, created_at)
        SELECT ?, ?, ?, ?, ? WHERE ${conditionSql}`)
        .bind(makeId("mus_alias"), id, alias, normalizeForDuplicate(alias), now, ...conditionBindings));
    }
    for (const source of input.sources) statements.push(sourceInsertStatement(this.db, "song", id, source, actor, now, conditionSql, conditionBindings));

    for (const version of versionRecords) {
      if (version.existing) {
        statements.push(this.db.prepare(`UPDATE song_versions SET slug = ?, title = ?, version_label = ?, artist_credit = ?,
          release_date = ?, notes = ?, published = ?, updated_at = ?
          WHERE id = ? AND song_id = ? AND ${conditionSql}`)
          .bind(version.slug, version.title, version.version_label, version.artist_credit, version.release_date ?? null,
            version.notes, version.published ? 1 : 0, now, version.id, id, ...conditionBindings));
      } else {
        statements.push(this.db.prepare(`INSERT INTO song_versions (
          id, song_id, slug, title, version_label, artist_credit, release_date, notes, published, created_at, updated_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${conditionSql}`)
          .bind(version.id, id, version.slug, version.title, version.version_label, version.artist_credit,
            version.release_date ?? null, version.notes, version.published ? 1 : 0, now, now, ...conditionBindings));
      }
      statements.push(this.db.prepare(`DELETE FROM catalog_sources
        WHERE subject_type = 'version' AND subject_id = ? AND ${conditionSql}`)
        .bind(version.id, ...conditionBindings));
      for (const source of version.sources) statements.push(sourceInsertStatement(this.db, "version", version.id, source, actor, now, conditionSql, conditionBindings));
    }

    const after = { ...input, id, slug, versions: versionRecords.map(({ existing: _existing, ...version }) => version), updated_at: now };
    statements.push(
      auditStatement(this.db, actor, requestId, before ? "content.song.update" : "content.song.create", "song", id, before, after, now, conditionSql, conditionBindings),
      receiptStatement(this.db, input.idempotency_key, "admin.song.save", id, now, conditionSql, conditionBindings),
    );
    const results = await this.db.batch(statements);
    if ((results[0].meta.changes ?? 0) !== 1) throw new ServiceError("version_conflict", "歌曲在保存前已发生变化，请刷新页面", 409);
    const saved = await getAdminSongById(this.db, id);
    if (!saved) throw new ServiceError("save_failed", "歌曲保存后无法读取", 500);
    return saved;
  }

  private async validateSongSlugs(songId: string, songSlug: string, versions: Array<{ id: string; slug: string }>): Promise<void> {
    const songConflict = await this.db.prepare("SELECT id FROM songs WHERE slug = ? AND id <> ?").bind(songSlug, songId).first<{ id: string }>();
    if (songConflict) throw new ServiceError("duplicate_slug", `歌曲 slug 已存在：${songSlug}`, 409);
    for (const version of versions) {
      const conflict = await this.db.prepare("SELECT id FROM song_versions WHERE slug = ? AND id <> ?")
        .bind(version.slug, version.id).first<{ id: string }>();
      if (conflict) throw new ServiceError("duplicate_slug", `歌曲版本 slug 已存在：${version.slug}`, 409);
    }
  }

  async saveRelease(raw: unknown, actor: Actor, requestId = makeId("req")): Promise<AdminReleaseDetail> {
    assertScope(actor, "music:write");
    const input = releaseSaveSchema.parse(raw);
    const receiptId = await receiptTarget(this.db, input.idempotency_key, "admin.release.save");
    if (receiptId) {
      const receiptRelease = await getAdminReleaseById(this.db, receiptId);
      if (receiptRelease) return receiptRelease;
    }
    const before = input.id ? await getAdminReleaseById(this.db, input.id) : null;
    if (input.id && !before) throw new ServiceError("not_found", "没有找到专辑", 404);
    if (before && before.updated_at !== input.expected_updated_at) throw new ServiceError("version_conflict", "专辑已经被修改，请刷新页面", 409);
    const coverUrl = input.cover_url === undefined ? before?.cover_url ?? null : input.cover_url;
    const coverSourceUrl = input.cover_source_url === undefined ? before?.cover_source_url ?? null : input.cover_source_url;
    if (coverUrl && !coverSourceUrl) throw new ServiceError("invalid_cover", "请填写封面来源页面", 400);
    const id = before?.id ?? makeId("mus_release");
    const slug = input.slug ?? before?.slug ?? catalogSlug("release", input.title, id);
    const now = nextUpdatedAt(before?.updated_at);
    const conditionSql = "EXISTS (SELECT 1 FROM releases WHERE id = ? AND updated_at = ?)";
    const conditionBindings = [id, now];
    const statements: D1PreparedStatement[] = [];
    if (before) {
      statements.push(this.db.prepare(`UPDATE releases SET slug = ?, title = ?, release_type = ?, release_date = ?,
        catalog_number = ?, edition = ?, notes = ?, published = ?, cover_url = ?, cover_source_url = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?`)
        .bind(slug, input.title, input.release_type, input.release_date ?? null, input.catalog_number, input.edition, input.notes, input.published ? 1 : 0, coverUrl, coverSourceUrl, now, id, before.updated_at));
    } else {
      statements.push(this.db.prepare(`INSERT INTO releases (
        id, slug, title, release_type, release_date, catalog_number, edition, notes, published, cover_url, cover_source_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, slug, input.title, input.release_type, input.release_date ?? null, input.catalog_number, input.edition, input.notes, input.published ? 1 : 0, coverUrl, coverSourceUrl, now, now));
    }
    // Track rows are recreated below, so their streaming ids are rewritten against the new row ids.
    // Fields left undefined keep what was stored for the same disc/track slot.
    const slotKey = (disc: number, track: number) => `${disc}:${track}`;
    const previousTrackIds = new Map((before?.tracks ?? []).map((track) => [slotKey(track.disc_number, track.track_number), track]));
    const appleAlbumId = input.apple_music_album_id === undefined ? before?.apple_music_album_id ?? null : input.apple_music_album_id;
    const appleStorefront = input.apple_music_storefront ?? before?.apple_music_storefront ?? "jp";
    statements.push(
      this.db.prepare(`DELETE FROM release_track_external_ids WHERE release_track_id IN (SELECT id FROM release_tracks WHERE release_id = ?) AND ${conditionSql}`).bind(id, ...conditionBindings),
      this.db.prepare(`DELETE FROM release_external_ids WHERE release_id = ? AND ${conditionSql}`).bind(id, ...conditionBindings),
    );
    if (appleAlbumId) {
      statements.push(this.db.prepare(`INSERT INTO release_external_ids (release_id, provider, external_id, storefront, checked_at)
        SELECT ?, 'apple_music', ?, ?, ? WHERE ${conditionSql}`).bind(id, appleAlbumId, appleStorefront, now, ...conditionBindings));
    }
    statements.push(
      this.db.prepare(`DELETE FROM release_tracks WHERE release_id = ? AND ${conditionSql}`).bind(id, ...conditionBindings),
      this.db.prepare(`DELETE FROM catalog_sources WHERE subject_type = 'release' AND subject_id = ? AND ${conditionSql}`).bind(id, ...conditionBindings),
    );
    const aliases = input.aliases ?? before?.aliases ?? [];
    if (input.aliases !== undefined) {
      statements.push(this.db.prepare(`DELETE FROM release_aliases WHERE release_id = ? AND ${conditionSql}`).bind(id, ...conditionBindings));
      for (const alias of input.aliases) {
        statements.push(this.db.prepare(`INSERT INTO release_aliases (id, release_id, alias, normalized_alias, created_at)
          SELECT ?, ?, ?, ?, ? WHERE ${conditionSql}`)
          .bind(makeId("mus_ralias"), id, alias, normalizeForDuplicate(alias), now, ...conditionBindings));
      }
    }
    const savedStreaming: Array<{ apple_music_track_id: string | null; youtube_video_id: string | null }> = [];
    for (const track of input.tracks) {
      const trackId = makeId("mus_track");
      statements.push(this.db.prepare(`INSERT INTO release_tracks (
        id, release_id, song_version_id, disc_number, track_number, display_title, notes, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${conditionSql}`)
        .bind(trackId, id, track.song_version_id, track.disc_number, track.track_number, track.display_title, track.notes, now, ...conditionBindings));
      const previous = previousTrackIds.get(slotKey(track.disc_number, track.track_number));
      const streaming = {
        apple_music_track_id: track.apple_music_track_id === undefined ? previous?.apple_music_track_id ?? null : track.apple_music_track_id,
        youtube_video_id: track.youtube_video_id === undefined ? previous?.youtube_video_id ?? null : track.youtube_video_id,
      };
      savedStreaming.push(streaming);
      for (const [provider, externalId, storefront] of [["apple_music", streaming.apple_music_track_id, appleStorefront], ["youtube", streaming.youtube_video_id, null]] as const) {
        if (!externalId) continue;
        statements.push(this.db.prepare(`INSERT INTO release_track_external_ids (release_track_id, provider, external_id, storefront, checked_at)
          SELECT ?, ?, ?, ?, ? WHERE ${conditionSql}`).bind(trackId, provider, externalId, storefront, now, ...conditionBindings));
      }
    }
    for (const source of input.sources) statements.push(sourceInsertStatement(this.db, "release", id, source, actor, now, conditionSql, conditionBindings));
    const after = {
      ...input, id, slug, aliases, cover_url: coverUrl, cover_source_url: coverSourceUrl, updated_at: now,
      apple_music_album_id: appleAlbumId, apple_music_storefront: appleAlbumId ? appleStorefront : null,
      tracks: input.tracks.map((track, index) => ({ ...track, ...savedStreaming[index] })),
    };
    statements.push(
      auditStatement(this.db, actor, requestId, before ? "content.release.update" : "content.release.create", "release", id, before, after, now, conditionSql, conditionBindings),
      receiptStatement(this.db, input.idempotency_key, "admin.release.save", id, now, conditionSql, conditionBindings),
    );
    const results = await this.db.batch(statements);
    if ((results[0].meta.changes ?? 0) !== 1) throw new ServiceError("version_conflict", "专辑在保存前已发生变化，请刷新页面", 409);
    const saved = await getAdminReleaseById(this.db, id);
    if (!saved) throw new ServiceError("save_failed", "专辑保存后无法读取", 500);
    return saved;
  }

  async saveSetlist(raw: unknown, actor: Actor, requestId = makeId("req")): Promise<AdminSetlistDetail> {
    assertScope(actor, "music:write");
    const input = setlistSaveSchema.parse(raw);
    const receiptId = await receiptTarget(this.db, input.idempotency_key, "admin.setlist.save");
    if (receiptId) {
      const receiptSetlist = await getAdminSetlistById(this.db, receiptId);
      if (receiptSetlist) return receiptSetlist;
    }
    const before = input.id ? await getAdminSetlistById(this.db, input.id) : null;
    if (input.id && !before) throw new ServiceError("not_found", "没有找到 Setlist", 404);
    if (before && before.updated_at !== input.expected_updated_at) throw new ServiceError("version_conflict", "Setlist 已经被修改，请刷新页面", 409);
    const entries = await this.resolveSetlistEntries(input);
    const id = before?.id ?? makeId("mus_set");
    const now = nextUpdatedAt(before?.updated_at);
    const conditionSql = "EXISTS (SELECT 1 FROM setlists WHERE id = ? AND updated_at = ?)";
    const conditionBindings = [id, now];
    const statements: D1PreparedStatement[] = [];
    if (before) {
      // The admin form no longer edits the title (the event alias names the show); omitted keeps it.
      statements.push(this.db.prepare(`UPDATE setlists SET event_id = ?, performance_label = ?,
        title = CASE WHEN ? THEN ? ELSE title END, completeness = ?,
        confidence = ?, notes = ?, published = ?, updated_at = ? WHERE id = ? AND updated_at = ?`)
        .bind(input.event_id, input.performance_label, input.title === undefined ? 0 : 1, input.title ?? null, input.completeness, input.confidence, input.notes, input.published ? 1 : 0, now, id, before.updated_at));
    } else {
      statements.push(this.db.prepare(`INSERT INTO setlists (
        id, event_id, performance_label, title, completeness, confidence, notes, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, input.event_id, input.performance_label, input.title ?? null, input.completeness, input.confidence, input.notes, input.published ? 1 : 0, now, now));
    }
    statements.push(
      this.db.prepare(`DELETE FROM setlist_entries WHERE setlist_id = ? AND ${conditionSql}`).bind(id, ...conditionBindings),
      this.db.prepare(`DELETE FROM catalog_sources WHERE subject_type = 'setlist' AND subject_id = ? AND ${conditionSql}`).bind(id, ...conditionBindings),
    );
    for (const [index, entry] of entries.entries()) {
      statements.push(this.db.prepare(`INSERT INTO setlist_entries (
        id, setlist_id, position, section, song_id, performed_version_id, display_title, medley_group, notes, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${conditionSql}`)
        .bind(makeId("mus_entry"), id, index + 1, entry.section, entry.song_id, entry.performed_version_id, entry.display_title, entry.medley_group, entry.notes, now, ...conditionBindings));
    }
    for (const source of input.sources) statements.push(sourceInsertStatement(this.db, "setlist", id, source, actor, now, conditionSql, conditionBindings));
    const after = { ...input, entries, id, updated_at: now };
    statements.push(
      auditStatement(this.db, actor, requestId, before ? "content.setlist.update" : "content.setlist.create", "setlist", id, before, after, now, conditionSql, conditionBindings),
      receiptStatement(this.db, input.idempotency_key, "admin.setlist.save", id, now, conditionSql, conditionBindings),
    );
    const results = await this.db.batch(statements);
    if ((results[0].meta.changes ?? 0) !== 1) throw new ServiceError("version_conflict", "Setlist 在保存前已发生变化，请刷新页面", 409);
    const saved = await getAdminSetlistById(this.db, id);
    if (!saved) throw new ServiceError("save_failed", "Setlist 保存后无法读取", 500);
    return saved;
  }

  private async resolveSetlistEntries(input: SetlistSaveInput): Promise<Array<SetlistSaveInput["entries"][number] & { display_title: string }>> {
    const songs = [...new Set(input.entries.map((entry) => entry.song_id))];
    const versions = [...new Set(input.entries.map((entry) => entry.performed_version_id).filter((id): id is string => Boolean(id)))];
    const songTitles = new Map<string, string>();
    const versionDetails = new Map<string, { song_id: string; title: string }>();
    for (let index = 0; index < songs.length; index += 40) {
      const chunk = songs.slice(index, index + 40);
      const result = await this.db.prepare(`SELECT id, title FROM songs WHERE id IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .all<{ id: string; title: string }>();
      for (const row of result.results) songTitles.set(row.id, row.title);
    }
    for (let index = 0; index < versions.length; index += 40) {
      const chunk = versions.slice(index, index + 40);
      const result = await this.db.prepare(`SELECT id, song_id, title FROM song_versions WHERE id IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .all<{ id: string; song_id: string; title: string }>();
      for (const row of result.results) versionDetails.set(row.id, { song_id: row.song_id, title: row.title });
    }

    return input.entries.map((entry, index) => {
      const songTitle = songTitles.get(entry.song_id);
      if (!songTitle) throw new ServiceError("invalid_song", `第 ${index + 1} 首的歌曲不存在`, 400);
      const version = entry.performed_version_id ? versionDetails.get(entry.performed_version_id) : null;
      if (entry.performed_version_id && version?.song_id !== entry.song_id) {
        throw new ServiceError("invalid_version", `第 ${index + 1} 首的歌曲版本不属于所选歌曲`, 400);
      }
      return {
        ...entry,
        display_title: entry.display_title || version?.title || songTitle,
      };
    });
  }
}

export type ReleaseTypeInput = ReleaseType;
export type SetlistCompletenessInput = SetlistCompleteness;
export type SetlistConfidenceInput = SetlistConfidence;
export type SetlistSectionInput = SetlistSection;
