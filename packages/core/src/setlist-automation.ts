/**
 * The daily task that collects setlists for shows that just ended.
 *
 * The agent reads any public web page, so nothing it says is trusted here: it can only add a
 * setlist to an event this run was started for, and a song only after the catalog was searched
 * for it. Everything else about the music library stays out of its reach.
 */
import { z } from "zod";
import { automationSubject } from "./automation-auth";
import { ChangeService } from "./change-service";
import { eventTourStopSql } from "./event-display";
import { getAdminSongById, listAdminSongs } from "./music-admin-repository";
import { getChangeSet, getEventById } from "./repository";
import { sourceUrlSchema } from "./schema";
import { SETLIST_SYNC_POLICY_VERSION, SYNC_TOOL_LIMIT } from "./sync-policy";
import type { Actor, ChangePreview, ChangeSet } from "./types";
import { assertScope, normalizeForDuplicate, nowIso, ServiceError } from "./utils";

/** How long after a show its setlist is still looked for. */
export const SETLIST_LOOKBACK_DAYS = 30;
/** Days after a show on which a search runs: often at first, then rarely, so a setlist nobody posted costs little. */
export const SETLIST_RETRY_DAYS: readonly number[] = [1, 2, 3, 5, 7, 10, 14, 21, 30];
export const SETLIST_RUN_EVENT_LIMIT = 5;
export const SETLIST_RUN_SONG_LIMIT = 6;
const RUN_CHANGE_LIMIT = 20;

export interface SetlistCandidate {
  event_id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  classification: string | null;
  venue: string | null;
  tour: string | null;
  days_since: number;
}

function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Ended shows with no setlist and none waiting for review, newest first. `today` is the day in
 * Japan. With `dueOnly`, only the shows whose retry day is today.
 */
export async function listSetlistCandidates(db: D1Database, today: string, dueOnly = true): Promise<SetlistCandidate[]> {
  const rows = await db.prepare(`
    SELECT e.id AS event_id, e.title, e.start_date, e.end_date, e.start_time, e.classification,
      (SELECT GROUP_CONCAT(COALESCE(ev.display_name_snapshot, v.canonical_name), ' / ')
        FROM event_venues ev JOIN venues v ON v.id = ev.venue_id WHERE ev.event_id = e.id) AS venue,
      ${eventTourStopSql("e")} AS tour
    FROM events e
    WHERE e.category = 'LIVE' AND e.classification IN ('专场', '拼盘')
      AND e.published = 1 AND e.archived_at IS NULL AND e.status NOT IN ('cancelled', 'postponed')
      AND COALESCE(e.end_date, e.start_date) BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM setlists s WHERE s.event_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM change_sets c WHERE c.subject_type = 'setlist' AND c.target_event_id = e.id AND c.status = 'proposed')
    ORDER BY COALESCE(e.end_date, e.start_date) DESC, e.id
  `).bind(shiftDay(today, -SETLIST_LOOKBACK_DAYS), shiftDay(today, -1)).all<Omit<SetlistCandidate, "days_since">>();
  return rows.results
    .map((row) => ({ ...row, days_since: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${row.end_date ?? row.start_date}T00:00:00Z`)) / 86_400_000) }))
    .filter((row) => !dueOnly || SETLIST_RETRY_DAYS.includes(row.days_since))
    .slice(0, SETLIST_RUN_EVENT_LIMIT);
}

const DECORATION = /\s*(?:-[^-]+-|\([^)]*\)|（[^）]*）|<[^>]*>|＜[^＞]*＞|\[[^\]]*\]|［[^］]*］|～[^～]*～|〜[^〜]*〜)\s*$/u;

/** The title without trailing version marks such as "-version2024-" or "(Live ver.)". */
export function baseSongTitle(title: string): string {
  let current = title.normalize("NFKC").trim();
  for (let round = 0; round < 3; round++) {
    const next = current.replace(DECORATION, "").trim();
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

export interface SongMatch { song_id: string; title: string; matched_on: "title" | "alias" | "version" | "base_title" }

/**
 * Songs the catalog already holds under any of these names: by title, alias or version title,
 * and by the name with its version marks removed, ignoring case, width, spaces and punctuation.
 */
export async function findExistingSongs(db: D1Database, names: readonly string[]): Promise<SongMatch[]> {
  const wanted = new Map<string, "exact" | "base_title">();
  for (const name of names) {
    const exact = normalizeForDuplicate(name), base = normalizeForDuplicate(baseSongTitle(name));
    if (exact) wanted.set(exact, "exact");
    if (base && !wanted.has(base)) wanted.set(base, "base_title");
  }
  if (!wanted.size) return [];
  const rows = await db.prepare(`
    SELECT s.id AS song_id, s.title, s.title AS name, 'title' AS kind FROM songs s
    UNION ALL SELECT s.id, s.title, a.alias, 'alias' FROM song_aliases a JOIN songs s ON s.id = a.song_id
    UNION ALL SELECT s.id, s.title, v.title, 'version' FROM song_versions v JOIN songs s ON s.id = v.song_id
  `).all<{ song_id: string; title: string; name: string; kind: "title" | "alias" | "version" }>();
  const found = new Map<string, SongMatch>();
  for (const row of rows.results) {
    const hit = wanted.get(normalizeForDuplicate(row.name));
    if (!hit) continue;
    const known = found.get(row.song_id);
    if (hit === "exact") {
      if (!known || known.matched_on === "base_title") found.set(row.song_id, { song_id: row.song_id, title: row.title, matched_on: row.kind });
    // A name that only matches once its version mark is removed must be the song itself, not another version of it.
    } else if (!known && row.kind !== "version") {
      found.set(row.song_id, { song_id: row.song_id, title: row.title, matched_on: "base_title" });
    }
  }
  return [...found.values()];
}

const entrySchema = z.object({
  song_id: z.string().trim().min(1).max(160),
  performed_version_id: z.string().trim().max(160).nullish().transform((value) => value || null),
  section: z.enum(["main", "encore", "double_encore", "opening", "other"]).default("main"),
  display_title: z.string().trim().max(240).nullish().transform((value) => value || null),
  medley_group: z.string().trim().max(40).nullish().transform((value) => value || null),
  notes: z.string().trim().max(1000).nullish().transform((value) => value || null),
});

export const syncSetlistSchema = z.object({
  event_id: z.string().trim().min(1).max(160).describe("取自任务输入 events 的 event_id"),
  performance_label: z.string().trim().min(1).max(160).default("本公演").describe("同一活动有昼夜两场等多场演出时才改，例如 昼公演 / 夜公演"),
  completeness: z.enum(["complete", "partial"]).describe("来源给出了全部曲目用 complete；只有部分曲目用 partial"),
  entries: z.array(entrySchema).min(1).max(80).describe("按演出顺序排列的曲目；song_id 取自 sync.find_songs 或 sync.create_song"),
  notes: z.string().trim().max(2000).nullish().transform((value) => value || null),
  source_url: sourceUrlSchema.describe("列出这份歌单的网页"),
  reason: z.string().trim().min(1).max(1000),
});

export const syncSongSchema = z.object({
  title: z.string().trim().min(1).max(240).describe("歌曲原名，不带 -version2024- 这类版本标记"),
  original_artist: z.string().trim().min(1).max(240).describe("原唱；fripSide 自己的歌填 fripSide，翻唱填原唱者"),
  aliases: z.array(z.string().trim().min(1).max(240)).max(10).default([]),
  source_url: sourceUrlSchema.describe("出现这首歌的歌单网页"),
  reason: z.string().trim().min(1).max(1000),
});

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface RunContext { runId: string; candidates: SetlistCandidate[]; autoPublish: boolean }

export class SetlistAutomationService {
  constructor(private readonly db: D1Database) {}

  private async authorize(actor: Actor, publish = false): Promise<RunContext> {
    assertScope(actor, "events:draft");
    if (!actor.automation_run_id || actor.id !== automationSubject || actor.type !== "ai" || actor.channel !== "mcp" || actor.automation_kind !== "setlists") {
      throw new ServiceError("forbidden", "需要歌单搜集任务的专用身份", 403);
    }
    const run = await this.db.prepare("SELECT status, auto_publish, created_at, policy_version, input_json FROM official_sync_runs WHERE id = ?")
      .bind(actor.automation_run_id).first<{ status: string; auto_publish: number; created_at: string; policy_version: string; input_json: string | null }>();
    if (!run || run.policy_version !== SETLIST_SYNC_POLICY_VERSION || !["starting", "running"].includes(run.status)
      || Date.now() - Date.parse(run.created_at) >= 3_600_000) throw new ServiceError("inactive_run", "歌单搜集任务已结束或过期", 403);
    if (publish) {
      assertScope(actor, "events:auto_publish");
      if (run.auto_publish !== 1) throw new ServiceError("forbidden", "当前任务未授权自动发布", 403);
    }
    let candidates: SetlistCandidate[] = [];
    try { candidates = (JSON.parse(run.input_json ?? "{}") as { input?: { events?: SetlistCandidate[] } }).input?.events ?? []; } catch { /* No events: nothing may be proposed. */ }
    return { runId: actor.automation_run_id, candidates, autoPublish: run.auto_publish === 1 };
  }

  private async countTool(actor: Actor, publish = false): Promise<RunContext> {
    const context = await this.authorize(actor, publish);
    const result = await this.db.prepare(`UPDATE official_sync_runs SET tool_calls=tool_calls+1,
      stop_requested=CASE WHEN tool_calls>=? THEN 1 ELSE stop_requested END WHERE id=? AND tool_calls<?`)
      .bind(SYNC_TOOL_LIMIT - 1, context.runId, SYNC_TOOL_LIMIT).run();
    if (!result.meta.changes) throw new ServiceError("tool_budget_exceeded", "本次工具调用已到上限，停止新操作", 429);
    return context;
  }

  private async link(runId: string, changeId: string, action: unknown): Promise<void> {
    await this.db.prepare(`INSERT OR IGNORE INTO official_sync_changes (run_id, change_id, action_json, created_at)
      SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM official_sync_changes WHERE run_id = ?) < ?`)
      .bind(runId, changeId, JSON.stringify(action), nowIso(), runId, RUN_CHANGE_LIMIT).run();
    const linked = await this.db.prepare("SELECT 1 FROM official_sync_changes WHERE run_id = ? AND change_id = ?").bind(runId, changeId).first();
    if (!linked) throw new ServiceError("run_limit", "本次任务的变更数量已达上限", 409);
  }

  private async describeSongs(ids: readonly string[]) {
    const songs = (await Promise.all(ids.map((id) => getAdminSongById(this.db, id)))).filter((song) => song !== null);
    return songs.map((song) => ({
      song_id: song.id, title: song.title, original_artist: song.original_artist, aliases: song.aliases, published: song.published,
      versions: song.versions.map((version) => ({ version_id: version.id, title: version.title, version_label: version.version_label, release_date: version.release_date })),
    }));
  }

  /** Whether the catalog holds a song under this name, and the nearest ones when it does not. */
  async findSongs(query: string, actor: Actor) {
    await this.countTool(actor);
    const exact = await findExistingSongs(this.db, [query]);
    const base = baseSongTitle(query);
    const similar = new Set<string>();
    for (const term of new Set([query, base])) for (const song of await listAdminSongs(this.db, term, 6)) similar.add(song.id);
    for (const match of exact) similar.delete(match.song_id);
    const matched = await this.describeSongs(exact.map((match) => match.song_id));
    return {
      query, exists: exact.length > 0,
      matches: matched.map((song) => ({ ...song, matched_on: exact.find((match) => match.song_id === song.song_id)!.matched_on })),
      similar: await this.describeSongs([...similar].slice(0, 6)),
      next_action: exact.length ? "use_matched_song_id" : "compare_similar_then_sync.create_song_only_if_absent",
    };
  }

  /** Adds a song the catalog lacks. A name the catalog already knows is refused with the song that holds it. */
  async createSong(raw: unknown, actor: Actor) {
    const { runId, autoPublish } = await this.countTool(actor);
    const input = syncSongSchema.parse(raw);
    const existing = await findExistingSongs(this.db, [input.title, ...input.aliases]);
    if (existing.length) {
      throw new ServiceError("duplicate_song", "音乐库已有这首歌，直接使用它的 song_id，不要新建", 409,
        { existing: await this.describeSongs(existing.map((match) => match.song_id)), next_action: "use_existing_song_id" });
    }
    const key = `setlist-sync:${runId}:song:${await sha256(normalizeForDuplicate(input.title))}`;
    const created = await this.db.prepare(`SELECT COUNT(*) AS n FROM official_sync_changes s JOIN change_sets c ON c.id = s.change_id
      WHERE s.run_id = ? AND c.subject_type = 'song' AND c.idempotency_key <> ?`).bind(runId, key).first<{ n: number }>();
    if ((created?.n ?? 0) >= SETLIST_RUN_SONG_LIMIT) throw new ServiceError("run_limit", `每次任务最多新建 ${SETLIST_RUN_SONG_LIMIT} 首歌曲，其余留给人工`, 409);
    const service = new ChangeService(this.db);
    const change = await service.proposeCatalog("song", {
      song: {
        // The fripSide period is left for a person to set.
        title: input.title, original_artist: input.original_artist, aliases: input.aliases, published: true,
        notes: "歌单搜集任务依据歌单来源自动新建，发行信息尚未核对。",
      },
      source_url: input.source_url, reason: input.reason, idempotency_key: key,
    }, actor);
    await this.link(runId, change.id, { kind: "song", ...input });
    if (!autoPublish) return { status: "proposed" as const, change_set_id: change.id, next_action: "本任务未授权发布；含这首歌的歌单留给人工处理" };
    if (change.status === "proposed") await service.publishAny(change.id, actor, `${key}:publish`);
    const published = await getChangeSet(this.db, change.id);
    const song = published?.subject_id ? await getAdminSongById(this.db, published.subject_id) : null;
    if (!song) throw new ServiceError("invalid_state", "歌曲未能创建", 409);
    return { status: "created" as const, change_set_id: change.id, song_id: song.id, title: song.title,
      versions: song.versions.map((version) => ({ version_id: version.id, title: version.title })), next_action: "use_song_id_in_sync.propose_setlist" };
  }

  /** A setlist for one of this run's events. Proposing again for the same show replaces the earlier attempt. */
  async proposeSetlist(raw: unknown, actor: Actor) {
    const { runId, candidates } = await this.countTool(actor);
    const input = syncSetlistSchema.parse(raw);
    if (!candidates.some((candidate) => candidate.event_id === input.event_id)) {
      throw new ServiceError("forbidden", "只能为本次任务输入 events 中列出的活动提交歌单", 403);
    }
    const service = new ChangeService(this.db);
    const earlier = await this.db.prepare(`SELECT c.id FROM official_sync_changes s JOIN change_sets c ON c.id = s.change_id
      WHERE s.run_id = ? AND c.subject_type = 'setlist' AND c.status = 'proposed' AND c.created_by = ? AND c.target_event_id = ?
      AND json_extract(c.payload_json, '$.setlist.performance_label') = ?`).bind(runId, actor.id, input.event_id, input.performance_label).all<{ id: string }>();
    const official = /^(?:www\.)?fripside\.net$/.test(new URL(input.source_url).hostname);
    const proposal = {
      event_id: input.event_id,
      setlist: {
        performance_label: input.performance_label, completeness: input.completeness,
        confidence: official ? "official" : "reported", notes: input.notes, published: true, entries: input.entries, sources: [],
      },
      source_url: input.source_url, reason: input.reason,
    };
    const key = `setlist-sync:${runId}:setlist:${await sha256(JSON.stringify(proposal))}`;
    const change = await service.proposeSetlist({ ...proposal, idempotency_key: key }, actor);
    for (const row of earlier.results) if (row.id !== change.id) await service.discard(row.id, actor);
    await this.link(runId, change.id, { kind: "setlist", ...input });
    return { status: "proposed" as const, change_set_id: change.id, next_action: "changes.preview" };
  }

  private async requireLinked(runId: string, changeId: string, actor: Actor): Promise<{ digest: string | null; change: ChangeSet }> {
    const link = await this.db.prepare("SELECT preview_digest FROM official_sync_changes WHERE run_id = ? AND change_id = ?")
      .bind(runId, changeId).first<{ preview_digest: string | null }>();
    const change = await getChangeSet(this.db, changeId);
    if (!link || !change || change.created_by !== actor.id || change.subject_type !== "setlist" || change.operation !== "create") {
      throw new ServiceError("forbidden", "只能处理本次任务提交的新增歌单", 403);
    }
    return { digest: link.preview_digest, change };
  }

  private async digest(preview: ChangePreview): Promise<string> {
    return sha256(JSON.stringify(preview));
  }

  async preview(changeId: string, actor: Actor) {
    const { runId } = await this.countTool(actor);
    await this.requireLinked(runId, changeId, actor);
    const preview = await new ChangeService(this.db).preview(changeId, actor);
    const previewDigest = await this.digest(preview);
    await this.db.prepare("UPDATE official_sync_changes SET preview_digest = ? WHERE run_id = ? AND change_id = ?").bind(previewDigest, runId, changeId).run();
    return {
      change_set_id: changeId, event: { event_id: preview.after?.id, title: preview.after?.title, start_date: preview.after?.start_date },
      setlist: preview.setlist?.after, warnings: preview.warnings, preview_digest: previewDigest,
      next_action: preview.warnings.length ? "fix_and_propose_again_or_leave_for_review" : "changes.publish_automatic",
    };
  }

  async publish(changeId: string, previewDigest: string, actor: Actor) {
    const { runId, candidates } = await this.countTool(actor, true);
    const { digest, change } = await this.requireLinked(runId, changeId, actor);
    if (change.status === "published") return { status: "unchanged" as const, change_id: change.id, setlist_id: change.subject_id, event_id: change.target_event_id };
    if (!digest || digest !== previewDigest) throw new ServiceError("preview_required", "必须先预览本次歌单", 409);
    const service = new ChangeService(this.db);
    const current = await service.preview(changeId, actor);
    if (await this.digest(current) !== previewDigest) throw new ServiceError("preview_changed", "资料已变化，请重新预览", 409);
    if (current.warnings.length) return { status: "review" as const, change_id: change.id, code: "preview_warning", warnings: current.warnings };
    const event = change.target_event_id ? await getEventById(this.db, change.target_event_id) : null;
    if (!event || !event.published || event.archived_at || !candidates.some((candidate) => candidate.event_id === event.id)) {
      throw new ServiceError("forbidden", "活动已不在本次任务范围内", 403);
    }
    await service.publishAny(change.id, actor, `${change.idempotency_key}:publish`);
    const published = await getChangeSet(this.db, change.id);
    return { status: "published" as const, change_id: change.id, setlist_id: published?.subject_id ?? null, event_id: event.id };
  }
}
