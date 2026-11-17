import { z } from "zod";
import { checkSave, ContentAdminService, type SaveHooks } from "./content-admin";
import { getAdminReleaseById, getAdminSongById } from "./music-admin-repository";
import { songPhasesFromMask } from "./music-types";
import type { AdminReleaseDetail, AdminSongDetail, CatalogSource } from "./music-types";
import { getChangeSet, getChangeSetByKey } from "./repository";
import { dateSchema, sourceInputSchema, sourceUrlSchema } from "./schema";
import { parseYouTubeId } from "./streaming-ids";
import { getTourById, type TourDetail } from "./tours";
import type { Actor, CatalogChangePreview, CatalogKind, ChangePreview, ChangeSet } from "./types";
import { assertScope, makeId, nowIso, ServiceError } from "./utils";

export const CATALOG_KINDS: readonly CatalogKind[] = ["song", "release", "tour"];

export function isCatalogKind(value: unknown): value is CatalogKind {
  return CATALOG_KINDS.includes(value as CatalogKind);
}

type Content = Record<string, unknown>;

/** What a catalog proposal stores: the whole record as it would be saved, and the version it was built on. */
interface CatalogPayload {
  kind: CatalogKind;
  id: string | null;
  expected_updated_at: string | null;
  input: Content;
}

const slug = z.string().trim().min(3).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = (max: number) => z.string().trim().max(max).nullish();
const sources = z.array(sourceInputSchema).max(10);
const aliases = z.array(z.string().trim().min(1).max(240)).max(80);

/** A video id, or any YouTube link to the video; stored as the id. */
const youtubeRef = z.string().trim().max(300).nullish().transform((value, context) => {
  if (value === null || value === undefined) return value;
  const id = parseYouTubeId(value);
  if (id) return id;
  context.addIssue({ code: "custom", message: "无法识别的 YouTube 链接或视频 ID" });
  return z.NEVER;
});
const appleTrackId = z.string().regex(/^\d{1,20}$/).nullish();

const songContentSchema = z.object({
  slug: slug.optional(),
  title: z.string().trim().min(1).max(240).optional(),
  original_artist: z.string().trim().min(1).max(240).optional(),
  first_release_date: dateSchema.nullish(),
  phases: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).max(3).optional().describe("fripSide 的时期（1、2、3）；翻唱和客串曲目留空数组"),
  notes: text(4000),
  published: z.boolean().optional(),
  aliases: aliases.optional().describe("给出时整体替换别名"),
  sources: sources.optional().describe("给出时整体替换来源"),
  versions: z.array(z.object({
    id: z.string().trim().min(1).max(160).optional().describe("修改已有版本时填 version_id；不填表示新增版本"),
    slug: slug.optional(),
    title: z.string().trim().min(1).max(240).optional(),
    version_label: text(160),
    artist_credit: z.string().trim().min(1).max(240).optional(),
    release_date: dateSchema.nullish(),
    notes: text(4000),
    published: z.boolean().optional(),
    sources: sources.optional(),
  })).max(50).optional().describe("只列出要修改或新增的版本，未列出的已有版本保持不变；已有版本不能删除。新建歌曲时省略会自动建一个与歌曲同名的版本"),
});

const releaseContentSchema = z.object({
  slug: slug.optional(),
  title: z.string().trim().min(1).max(240).optional(),
  release_type: z.enum(["album", "single", "ep", "compilation", "video", "other"]).optional(),
  release_date: dateSchema.nullish(),
  catalog_number: text(120),
  edition: text(160),
  notes: text(4000),
  published: z.boolean().optional(),
  cover_url: text(2048).describe("只能是已导入本站图片库的封面路径"),
  cover_source_url: text(2048),
  aliases: aliases.optional().describe("给出时整体替换别名"),
  sources: sources.optional().describe("给出时整体替换来源"),
  apple_music_album_id: z.string().regex(/^\d{1,20}$/).nullish(),
  apple_music_storefront: z.string().regex(/^[a-z]{2}$/).nullish(),
  tracks: z.array(z.object({
    song_version_id: z.string().trim().min(1).max(160),
    disc_number: z.number().int().min(1).max(99).default(1),
    track_number: z.number().int().min(1).max(999),
    display_title: z.string().trim().min(1).max(240),
    notes: text(1000),
    apple_music_track_id: appleTrackId.describe("省略时沿用同一碟号和曲序上已保存的值，null 表示清空"),
    youtube_video_id: youtubeRef.describe("YouTube 视频链接或 ID；省略时沿用已保存的值，null 表示清空"),
  })).max(80).optional().describe("给出时整体替换曲目表；song_version_id 取自 songs.search 或 songs.get"),
  track_links: z.array(z.object({
    disc_number: z.number().int().min(1).max(99).default(1),
    track_number: z.number().int().min(1).max(999),
    apple_music_track_id: appleTrackId,
    youtube_video_id: youtubeRef.describe("YouTube 视频链接或 ID，null 表示清空"),
  })).max(80).optional().describe("只改某几首曲目的试听链接时用它，不必重发整张曲目表；按碟号和曲序定位曲目"),
});

const tourContentSchema = z.object({
  slug: slug.optional(),
  name: z.string().trim().min(1).max(240).optional(),
  notes: text(2000),
  published: z.boolean().optional(),
});

function proposalSchema<T extends z.ZodType>(idKey: string, contentKey: string, content: T, noun: string) {
  return z.object({
    [idKey]: z.string().trim().min(1).max(160).optional().describe(`修改已有${noun}时填写；新增时不填`),
    expected_updated_at: z.string().trim().min(1).optional().describe(`修改时必填，取自读取${noun}时返回的 updated_at`),
    [contentKey]: content.describe(`新增时给出完整内容；修改时只给要改的字段，其余保持不变`),
    source_url: sourceUrlSchema.optional().describe("依据的来源页面；会一并记入来源"),
    reason: z.string().trim().min(1).max(1000),
    idempotency_key: z.string().trim().min(8).max(200),
  });
}

export const proposeSongSchema = proposalSchema("song_id", "song", songContentSchema, "歌曲");
export const proposeReleaseSchema = proposalSchema("release_id", "release", releaseContentSchema, "专辑");
export const proposeTourSchema = proposalSchema("tour_id", "tour", tourContentSchema, "巡演");

function sourceInputs(list: CatalogSource[]): Content[] {
  return list.map((source) => ({ url: source.url, ...(source.label ? { label: source.label } : {}), ...(source.source_type ? { source_type: source.source_type } : {}) }));
}

/** Drops keys a caller left out, so spreading a patch over the stored record keeps what was not mentioned. */
function given(content: Content): Content {
  return Object.fromEntries(Object.entries(content).filter(([, value]) => value !== undefined));
}

function withSource(list: Content[], url: string | null | undefined): Content[] {
  return !url || list.some((source) => source.url === url) ? list : [...list, { url }].slice(0, 10);
}

interface KindSpec<Detail extends { id: string; updated_at: string }> {
  noun: string;
  idKey: string;
  contentKey: string;
  schema: z.ZodType;
  load(db: D1Database, id: string): Promise<Detail | null>;
  /** The stored record in the shape its save takes. */
  snapshot(detail: Detail): Content;
  /** The record as it would be saved: the patch laid over the stored one, or over defaults for a new one. */
  merge(before: Content | null, patch: Content, sourceUrl: string | null | undefined): Content;
  check?(db: D1Database, input: Content): Promise<void>;
  save(service: ContentAdminService, input: Content, actor: Actor, requestId: string, hooks: SaveHooks): Promise<{ id: string }>;
}

const song: KindSpec<AdminSongDetail> = {
  noun: "歌曲", idKey: "song_id", contentKey: "song", schema: proposeSongSchema,
  load: getAdminSongById,
  snapshot: (detail) => ({
    slug: detail.slug, title: detail.title, original_artist: detail.original_artist, first_release_date: detail.first_release_date,
    phases: songPhasesFromMask(detail.phase_mask), notes: detail.notes, published: detail.published,
    aliases: detail.aliases, sources: sourceInputs(detail.sources),
    versions: detail.versions.map((version) => ({
      id: version.id, slug: version.slug, title: version.title, version_label: version.version_label,
      artist_credit: version.artist_credit, release_date: version.release_date, notes: version.notes,
      published: version.published, sources: sourceInputs(version.sources),
    })),
  }),
  merge(before, patch, sourceUrl) {
    const { versions: versionPatches, ...fields } = patch as Content & { versions?: Content[] };
    const merged: Content = { first_release_date: null, notes: null, published: true, aliases: [], sources: [], ...before, ...given(fields) };
    const stored = (before?.versions ?? []) as Content[];
    const unknown = (versionPatches ?? []).find((version) => version.id && !stored.some((item) => item.id === version.id));
    if (unknown) throw new ServiceError("invalid_version", `歌曲版本 ${String(unknown.id)} 不属于这首歌曲`, 400);
    const added = (versionPatches ?? []).filter((version) => !version.id).map((version) => ({
      title: merged.title, version_label: null, artist_credit: merged.original_artist, release_date: merged.first_release_date,
      notes: null, published: true, sources: [], ...given(version),
    }));
    merged.versions = [
      ...stored.map((version) => ({ ...version, ...given((versionPatches ?? []).find((item) => item.id === version.id) ?? {}) })),
      ...added,
    ];
    if (!before && !(merged.versions as Content[]).length) {
      merged.versions = [{ title: merged.title, version_label: null, artist_credit: merged.original_artist, release_date: merged.first_release_date, notes: null, published: true, sources: [] }];
    }
    merged.sources = withSource(merged.sources as Content[], sourceUrl);
    return merged;
  },
  save: (service, input, actor, requestId, hooks) => service.saveSong(input, actor, requestId, hooks),
};

const release: KindSpec<AdminReleaseDetail> = {
  noun: "专辑", idKey: "release_id", contentKey: "release", schema: proposeReleaseSchema,
  load: getAdminReleaseById,
  snapshot: (detail) => ({
    slug: detail.slug, title: detail.title, release_type: detail.release_type, release_date: detail.release_date,
    catalog_number: detail.catalog_number, edition: detail.edition, notes: detail.notes, published: detail.published,
    cover_url: detail.cover_url, cover_source_url: detail.cover_source_url, aliases: detail.aliases,
    apple_music_album_id: detail.apple_music_album_id, apple_music_storefront: detail.apple_music_storefront,
    sources: sourceInputs(detail.sources),
    tracks: detail.tracks.map((track) => ({
      song_version_id: track.version_id, disc_number: track.disc_number, track_number: track.track_number,
      display_title: track.display_title, notes: track.notes,
      apple_music_track_id: track.apple_music_track_id ?? null, youtube_video_id: track.youtube_video_id ?? null,
    })),
  }),
  merge(before, patch, sourceUrl) {
    const { track_links: links, ...fields } = patch as Content & { track_links?: Content[] };
    const merged: Content = {
      release_date: null, catalog_number: null, edition: null, notes: null, published: true, cover_url: null, cover_source_url: null,
      aliases: [], apple_music_album_id: null, apple_music_storefront: null, sources: [], tracks: [], ...before, ...given(fields),
    };
    // A track that does not mention a streaming id keeps the one stored for its disc and track number.
    const stored = new Map(((before?.tracks ?? []) as Content[]).map((track) => [`${track.disc_number}:${track.track_number}`, track]));
    merged.tracks = (merged.tracks as Content[]).map((track) => {
      const previous = stored.get(`${track.disc_number}:${track.track_number}`);
      return {
        ...track, notes: track.notes ?? null,
        apple_music_track_id: track.apple_music_track_id === undefined ? previous?.apple_music_track_id ?? null : track.apple_music_track_id,
        youtube_video_id: track.youtube_video_id === undefined ? previous?.youtube_video_id ?? null : track.youtube_video_id,
      };
    });
    for (const link of links ?? []) {
      const { disc_number: disc, track_number: number, ...ids } = link;
      const index = (merged.tracks as Content[]).findIndex((track) => track.disc_number === disc && track.track_number === number);
      if (index < 0) throw new ServiceError("invalid_track", `专辑没有 Disc ${String(disc)} Track ${String(number)}`, 400);
      (merged.tracks as Content[])[index] = { ...(merged.tracks as Content[])[index], ...given(ids) };
    }
    merged.sources = withSource(merged.sources as Content[], sourceUrl);
    return merged;
  },
  async check(db, input) {
    const ids = [...new Set((input.tracks as Content[]).map((track) => String(track.song_version_id)))];
    if (!ids.length) return;
    const found = await db.prepare(`SELECT id FROM song_versions WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string }>();
    const known = new Set(found.results.map((row) => row.id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length) throw new ServiceError("invalid_version", `歌曲版本不存在：${missing.join("、")}`, 400);
  },
  save: (service, input, actor, requestId, hooks) => service.saveRelease(input, actor, requestId, hooks),
};

const tour: KindSpec<TourDetail> = {
  noun: "巡演", idKey: "tour_id", contentKey: "tour", schema: proposeTourSchema,
  load: getTourById,
  snapshot: (detail) => ({ slug: detail.slug, name: detail.name, notes: detail.notes, published: detail.published }),
  merge: (before, patch) => ({ notes: null, published: true, ...before, ...given(patch) }),
  save: (service, input, actor, requestId, hooks) => service.saveTour(input, actor, requestId, hooks),
};

const KINDS = { song, release, tour } as unknown as Record<CatalogKind, KindSpec<{ id: string; updated_at: string }>>;

function payloadOf(change: ChangeSet): CatalogPayload {
  return JSON.parse(change.payload_json) as CatalogPayload;
}

function saveInput(payload: CatalogPayload, idempotencyKey: string): Content {
  return {
    ...payload.input,
    ...(payload.id ? { id: payload.id, expected_updated_at: payload.expected_updated_at } : {}),
    idempotency_key: idempotencyKey,
  };
}

/** Everything that would stop the proposal from being saved as things stand, as the save itself reports it. */
async function problemOf(db: D1Database, payload: CatalogPayload, actor: Actor): Promise<string | null> {
  const spec = KINDS[payload.kind];
  try {
    await spec.check?.(db, payload.input);
    // The check stops before any write, so it may run for an actor who can propose but not save.
    const checker = { ...actor, scopes: [...actor.scopes, "music:write", "events:publish"] };
    await checkSave(spec.save(new ContentAdminService(db), saveInput(payload, `check:${makeId("chk")}`), checker, "check", { check: true }));
    return null;
  } catch (error) {
    if (error instanceof ServiceError) return error.message;
    if (error instanceof z.ZodError) return error.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`).join("；");
    throw error;
  }
}

export async function proposeCatalog(db: D1Database, kind: CatalogKind, raw: unknown, actor: Actor, requestId = makeId("req")): Promise<ChangeSet> {
  assertScope(actor, "events:draft");
  const spec = KINDS[kind];
  const input = spec.schema.parse(raw) as Content;
  const idempotencyKey = String(input.idempotency_key);
  const existing = await getChangeSetByKey(db, idempotencyKey);
  if (existing) return existing;
  const id = input[spec.idKey] ? String(input[spec.idKey]) : null;
  const before = id ? await spec.load(db, id) : null;
  if (id && !before) throw new ServiceError("not_found", `没有找到${spec.noun}`, 404);
  if (before && !input.expected_updated_at) throw new ServiceError("invalid_request", `修改${spec.noun}时必须提供 expected_updated_at`, 400);
  if (before && before.updated_at !== input.expected_updated_at) {
    throw new ServiceError("version_conflict", `${spec.noun}在读取之后被修改过，请重新读取后再提案`, 409);
  }
  const sourceUrl = (input.source_url as string | undefined) ?? null;
  const payload: CatalogPayload = {
    kind, id, expected_updated_at: before?.updated_at ?? null,
    input: spec.merge(before ? spec.snapshot(before) : null, input[spec.contentKey] as Content, sourceUrl),
  };
  if (before && JSON.stringify(spec.snapshot(before)) === JSON.stringify(payload.input)) {
    throw new ServiceError("no_change", `提案内容与当前${spec.noun}相同`, 400);
  }
  const problem = await problemOf(db, payload, actor);
  if (problem) throw new ServiceError(`invalid_${kind}`, problem, 400);

  const changeId = makeId("chg");
  const createdAt = nowIso();
  const operation = before ? "update" : "create";
  await db.batch([
    db.prepare(`INSERT INTO change_sets (
      id, operation, target_event_id, base_version, payload_json, source_url, reason,
      status, idempotency_key, created_by, created_via, created_at, chat_session_id, subject_type, subject_id
    ) VALUES (?, ?, NULL, NULL, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(changeId, operation, JSON.stringify(payload), sourceUrl, String(input.reason), idempotencyKey, actor.id, actor.channel, createdAt, actor.chat_session_id ?? null, kind, id),
    db.prepare(`INSERT INTO audit_logs (
      id, actor_id, actor_type, channel, action, target_type, target_id, request_id, before_json, after_json, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, 'change_set', ?, ?, NULL, ?, ?, ?)`)
      .bind(makeId("aud"), actor.id, actor.type, actor.channel, `change.propose_${kind}_${operation}`, changeId, requestId, JSON.stringify(payload), JSON.stringify({ [spec.idKey]: id }), createdAt),
  ]);
  return (await getChangeSet(db, changeId))!;
}

export async function previewCatalog(db: D1Database, change: ChangeSet, actor: Actor): Promise<ChangePreview> {
  const payload = payloadOf(change);
  const spec = KINDS[payload.kind];
  const warnings: string[] = [];
  let before: Content | null = null;
  if (change.status !== "proposed") {
    // Once published the stored record is the proposal's own result, so there is nothing left to compare.
    warnings.push(`提案当前状态为 ${change.status}，不能再次发布`);
  } else {
    const stored = payload.id ? await spec.load(db, payload.id) : null;
    before = stored ? spec.snapshot(stored) : null;
    if (payload.id && !stored) warnings.push(`要修改的${spec.noun}已不存在`);
    else if (stored && stored.updated_at !== payload.expected_updated_at) warnings.push(`${spec.noun}在提案之后被修改过，需要基于最新内容重新提案`);
    else {
      const problem = await problemOf(db, payload, actor);
      if (problem) warnings.push(`发布会失败：${problem}`);
    }
  }
  const catalog: CatalogChangePreview = { kind: payload.kind, id: payload.id ?? change.subject_id ?? null, before, after: payload.input };
  return { change, before: null, after: {}, catalog, duplicate_candidates: [], warnings, public_path: null };
}

export async function publishCatalog(db: D1Database, change: ChangeSet, actor: Actor, idempotencyKey: string, requestId: string): Promise<void> {
  const payload = payloadOf(change);
  const spec = KINDS[payload.kind];
  const operation = payload.id ? "update" : "create";
  await spec.check?.(db, payload.input);
  await spec.save(new ContentAdminService(db), saveInput(payload, `${idempotencyKey}:${payload.kind}`), actor, requestId, {
    extra: ({ id, now, conditionSql, conditionBindings }) => [
      db.prepare(`UPDATE change_sets SET status = 'published', reviewed_by = ?, reviewed_at = ?, published_at = ?, subject_id = ?
        WHERE id = ? AND status = 'proposed' AND ${conditionSql}`).bind(actor.id, now, now, id, change.id, ...conditionBindings),
      db.prepare(`INSERT INTO audit_logs (
        id, actor_id, actor_type, channel, action, target_type, target_id, request_id, before_json, after_json, metadata_json, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ? WHERE ${conditionSql}`)
        .bind(makeId("aud"), actor.id, actor.type, actor.channel, `change.publish_${payload.kind}_${operation}`, payload.kind, id, requestId,
          JSON.stringify({ [spec.idKey]: id }), JSON.stringify({ change_set_id: change.id }), now, ...conditionBindings),
      db.prepare(`INSERT INTO operation_receipts (idempotency_key, operation, result_json, created_at) SELECT ?, 'publish', ?, ? WHERE ${conditionSql}`)
        .bind(idempotencyKey, JSON.stringify({ subject_type: payload.kind, subject_id: id }), now, ...conditionBindings),
    ],
  });
}
