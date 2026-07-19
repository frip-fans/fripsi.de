import { z } from "zod";
import { getAdminReleaseById, getAdminSetlistById, getAdminSongById } from "./music-admin-repository";
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
import { dateSchema, eventDraftSchema, sourceInputSchema, type EventDraft } from "./schema";
import type { Actor, EventRecord } from "./types";
import { assertScope, createEventSlug, makeId, normalizeForDuplicate, ServiceError, slugify } from "./utils";

const idempotencyKeySchema = z.string().trim().min(8).max(200);
const optionalIdSchema = z.string().trim().min(1).max(160).optional();
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((value) => value || null);
const slugSchema = z.string().trim().min(3).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug 只能包含小写字母、数字和连字符");
const catalogSourceSchema = sourceInputSchema;

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

export const directEventSaveSchema = z.object({
  id: optionalIdSchema,
  expected_version: z.number().int().positive().optional(),
  published: z.boolean(),
  idempotency_key: idempotencyKeySchema,
  event: eventDraftSchema,
}).superRefine((input, context) => {
  if (input.id && !input.expected_version) {
    context.addIssue({ code: "custom", path: ["expected_version"], message: "编辑活动时缺少版本号" });
  }
});

export const eventArchiveSchema = z.object({
  id: z.string().trim().min(1).max(160),
  expected_version: z.number().int().positive(),
  archived: z.boolean(),
  idempotency_key: idempotencyKeySchema,
});

const releaseTrackSchema = z.object({
  song_version_id: z.string().trim().min(1).max(160),
  disc_number: z.number().int().min(1).max(99),
  track_number: z.number().int().min(1).max(999),
  display_title: z.string().trim().min(1).max(240),
  notes: optionalText(1000),
});

export const releaseSaveSchema = z.object({
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
});

const setlistEntrySchema = z.object({
  song_id: z.string().trim().min(1).max(160),
  performed_version_id: optionalText(160),
  section: z.enum(["main", "encore", "double_encore", "opening", "other"]),
  display_title: z.string().trim().min(1).max(240),
  medley_group: optionalText(40),
  notes: optionalText(1000),
});

export const setlistSaveSchema = z.object({
  id: optionalIdSchema,
  expected_updated_at: z.string().trim().min(1).optional(),
  idempotency_key: idempotencyKeySchema,
  event_id: z.string().trim().min(1).max(160),
  performance_label: z.string().trim().min(1).max(160),
  title: optionalText(240),
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
    venue: cleanNullable(input.venue),
    region: cleanNullable(input.region),
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
    const now = nextUpdatedAt(existing?.updated_at);
    const conditionSql = "EXISTS (SELECT 1 FROM events WHERE id = ? AND updated_at = ?)";
    const conditionBindings = [id, now];
    const statements: D1PreparedStatement[] = [];

    if (existing) {
      statements.push(this.db.prepare(`UPDATE events SET
        slug = ?, title = ?, start_date = ?, end_date = ?, start_time = ?, end_time = ?, timezone = ?,
        category = ?, classification = ?, venue = ?, region = ?, remark = ?, status = ?, published = ?,
        version = version + 1, updated_at = ?,
        published_at = CASE WHEN ? = 1 AND published_at IS NULL THEN ? ELSE published_at END
        WHERE id = ? AND version = ? AND updated_at = ?`)
        .bind(
          event.slug, event.title, event.start_date, event.end_date, event.start_time, event.end_time, event.timezone,
          event.category, event.classification, event.venue, event.region, event.remark, event.status,
          input.published ? 1 : 0, now, input.published ? 1 : 0, now, id, existing.version, existing.updated_at,
        ));
    } else {
      statements.push(this.db.prepare(`INSERT INTO events (
        id, slug, title, start_date, end_date, start_time, end_time, timezone, category,
        classification, venue, region, remark, status, published, version, created_at, updated_at, published_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)`)
        .bind(
          id, event.slug, event.title, event.start_date, event.end_date, event.start_time, event.end_time,
          event.timezone, event.category, event.classification, event.venue, event.region, event.remark,
          event.status, input.published ? 1 : 0, now, now, input.published ? now : null,
        ));
    }

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
    const after = { ...event, id, published: input.published };
    statements.push(
      auditStatement(this.db, actor, requestId, existing ? "content.event.update" : "content.event.create", "event", id, existing, after, now, conditionSql, conditionBindings),
      receiptStatement(this.db, input.idempotency_key, "admin.event.save", id, now, conditionSql, conditionBindings),
    );
    const results = await this.db.batch(statements);
    if ((results[0].meta.changes ?? 0) !== 1) throw new ServiceError("version_conflict", "活动在保存前已发生变化，请刷新页面", 409);
    return requireEvent(this.db, id);
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
        first_release_date = ?, notes = ?, published = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?`)
        .bind(slug, input.title, normalizeForDuplicate(input.title), input.original_artist, input.first_release_date ?? null,
          input.notes, input.published ? 1 : 0, now, id, before.updated_at));
    } else {
      statements.push(this.db.prepare(`INSERT INTO songs (
        id, slug, title, normalized_title, original_artist, first_release_date, notes, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, slug, input.title, normalizeForDuplicate(input.title), input.original_artist, input.first_release_date ?? null,
          input.notes, input.published ? 1 : 0, now, now));
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
    const id = before?.id ?? makeId("mus_release");
    const slug = input.slug ?? before?.slug ?? catalogSlug("release", input.title, id);
    const now = nextUpdatedAt(before?.updated_at);
    const conditionSql = "EXISTS (SELECT 1 FROM releases WHERE id = ? AND updated_at = ?)";
    const conditionBindings = [id, now];
    const statements: D1PreparedStatement[] = [];
    if (before) {
      statements.push(this.db.prepare(`UPDATE releases SET slug = ?, title = ?, release_type = ?, release_date = ?,
        catalog_number = ?, edition = ?, notes = ?, published = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?`)
        .bind(slug, input.title, input.release_type, input.release_date ?? null, input.catalog_number, input.edition, input.notes, input.published ? 1 : 0, now, id, before.updated_at));
    } else {
      statements.push(this.db.prepare(`INSERT INTO releases (
        id, slug, title, release_type, release_date, catalog_number, edition, notes, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, slug, input.title, input.release_type, input.release_date ?? null, input.catalog_number, input.edition, input.notes, input.published ? 1 : 0, now, now));
    }
    statements.push(
      this.db.prepare(`DELETE FROM release_tracks WHERE release_id = ? AND ${conditionSql}`).bind(id, ...conditionBindings),
      this.db.prepare(`DELETE FROM catalog_sources WHERE subject_type = 'release' AND subject_id = ? AND ${conditionSql}`).bind(id, ...conditionBindings),
    );
    for (const track of input.tracks) {
      statements.push(this.db.prepare(`INSERT INTO release_tracks (
        id, release_id, song_version_id, disc_number, track_number, display_title, notes, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${conditionSql}`)
        .bind(makeId("mus_track"), id, track.song_version_id, track.disc_number, track.track_number, track.display_title, track.notes, now, ...conditionBindings));
    }
    for (const source of input.sources) statements.push(sourceInsertStatement(this.db, "release", id, source, actor, now, conditionSql, conditionBindings));
    const after = { ...input, id, slug, updated_at: now };
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
    await this.validateSetlistVersions(input);
    const id = before?.id ?? makeId("mus_set");
    const now = nextUpdatedAt(before?.updated_at);
    const conditionSql = "EXISTS (SELECT 1 FROM setlists WHERE id = ? AND updated_at = ?)";
    const conditionBindings = [id, now];
    const statements: D1PreparedStatement[] = [];
    if (before) {
      statements.push(this.db.prepare(`UPDATE setlists SET event_id = ?, performance_label = ?, title = ?, completeness = ?,
        confidence = ?, notes = ?, published = ?, updated_at = ? WHERE id = ? AND updated_at = ?`)
        .bind(input.event_id, input.performance_label, input.title, input.completeness, input.confidence, input.notes, input.published ? 1 : 0, now, id, before.updated_at));
    } else {
      statements.push(this.db.prepare(`INSERT INTO setlists (
        id, event_id, performance_label, title, completeness, confidence, notes, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, input.event_id, input.performance_label, input.title, input.completeness, input.confidence, input.notes, input.published ? 1 : 0, now, now));
    }
    statements.push(
      this.db.prepare(`DELETE FROM setlist_entries WHERE setlist_id = ? AND ${conditionSql}`).bind(id, ...conditionBindings),
      this.db.prepare(`DELETE FROM catalog_sources WHERE subject_type = 'setlist' AND subject_id = ? AND ${conditionSql}`).bind(id, ...conditionBindings),
    );
    for (const [index, entry] of input.entries.entries()) {
      statements.push(this.db.prepare(`INSERT INTO setlist_entries (
        id, setlist_id, position, section, song_id, performed_version_id, display_title, medley_group, notes, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${conditionSql}`)
        .bind(makeId("mus_entry"), id, index + 1, entry.section, entry.song_id, entry.performed_version_id, entry.display_title, entry.medley_group, entry.notes, now, ...conditionBindings));
    }
    for (const source of input.sources) statements.push(sourceInsertStatement(this.db, "setlist", id, source, actor, now, conditionSql, conditionBindings));
    const after = { ...input, id, updated_at: now };
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

  private async validateSetlistVersions(input: SetlistSaveInput): Promise<void> {
    const versions = [...new Set(input.entries.map((entry) => entry.performed_version_id).filter((id): id is string => Boolean(id)))];
    const versionSongs = new Map<string, string>();
    for (let index = 0; index < versions.length; index += 40) {
      const chunk = versions.slice(index, index + 40);
      const result = await this.db.prepare(`SELECT id, song_id FROM song_versions WHERE id IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .all<{ id: string; song_id: string }>();
      for (const row of result.results) versionSongs.set(row.id, row.song_id);
    }
    for (const [index, entry] of input.entries.entries()) {
      if (!entry.performed_version_id) continue;
      if (versionSongs.get(entry.performed_version_id) !== entry.song_id) {
        throw new ServiceError("invalid_version", `第 ${index + 1} 首的歌曲版本不属于所选歌曲`, 400);
      }
    }
  }
}

export type ReleaseTypeInput = ReleaseType;
export type SetlistCompletenessInput = SetlistCompleteness;
export type SetlistConfidenceInput = SetlistConfidence;
export type SetlistSectionInput = SetlistSection;
