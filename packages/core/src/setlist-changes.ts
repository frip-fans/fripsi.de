import { ContentAdminService } from "./content-admin";
import { getAdminSetlistById } from "./music-admin-repository";
import type { AdminSetlistDetail } from "./music-types";
import { getChangeSet, getChangeSetByKey, requireEvent } from "./repository";
import { proposeSetlistSchema, type ProposeSetlistInput, type SourceInput } from "./schema";
import type { Actor, ChangePreview, ChangeSet, EventRecord, SetlistChangePreview, SetlistSnapshot } from "./types";
import { assertScope, makeId, nowIso, ServiceError } from "./utils";

/** What a setlist proposal stores: the full replacement setlist and the version of the one it replaces. */
interface SetlistPayload {
  setlist_id: string | null;
  expected_updated_at: string | null;
  event_id: string;
  setlist: ProposeSetlistInput["setlist"];
}

function payloadOf(change: ChangeSet): SetlistPayload {
  return JSON.parse(change.payload_json) as SetlistPayload;
}

function snapshotOf(setlist: AdminSetlistDetail): SetlistSnapshot {
  return {
    performance_label: setlist.performance_label,
    completeness: setlist.completeness,
    confidence: setlist.confidence,
    notes: setlist.notes,
    published: setlist.published,
    entries: setlist.entries.map((entry) => ({
      position: entry.position, section: entry.section, song_id: entry.song_id, song_title: entry.song_title,
      performed_version_id: entry.performed_version_id, performed_version_title: entry.performed_version_title,
      display_title: entry.display_title, medley_group: entry.medley_group, notes: entry.notes,
    })),
    sources: setlist.sources.map((source) => source.url),
  };
}

/** Sources a publish stores: what the setlist already cites, then the proposal's own, without repeats. */
function mergedSources(before: AdminSetlistDetail | null, payload: SetlistPayload, changeSource: string | null): SourceInput[] {
  const merged = new Map<string, SourceInput>();
  for (const source of before?.sources ?? []) merged.set(source.url, { url: source.url, label: source.label ?? undefined, source_type: source.source_type ?? undefined });
  for (const source of payload.setlist.sources) if (!merged.has(source.url)) merged.set(source.url, source);
  if (changeSource && !merged.has(changeSource)) merged.set(changeSource, { url: changeSource });
  return [...merged.values()].slice(0, 10);
}

/**
 * Reasons a setlist proposal could not be published as things stand. Proposing refuses on any of
 * them; a preview reports them, so a reviewer still sees a proposal that went stale while it waited.
 */
async function blockers(db: D1Database, payload: SetlistPayload, before: AdminSetlistDetail | null): Promise<string[]> {
  const problems: string[] = [];
  if (payload.setlist_id) {
    if (!before) return ["要修改的歌单已不存在"];
    if (before.updated_at !== payload.expected_updated_at) problems.push("歌单在提案之后被修改过，需要基于最新内容重新提案");
  }
  const clash = await db.prepare("SELECT id FROM setlists WHERE event_id = ? AND performance_label = ? AND id <> ?")
    .bind(payload.event_id, payload.setlist.performance_label, payload.setlist_id ?? "").first<{ id: string }>();
  if (clash) problems.push(`该活动已有场次为「${payload.setlist.performance_label}」的歌单（${clash.id}），请改为修改它或换一个场次名称`);
  return problems;
}

async function afterSnapshot(db: D1Database, payload: SetlistPayload, before: AdminSetlistDetail | null, changeSource: string | null): Promise<SetlistSnapshot> {
  const entries = await new ContentAdminService(db).resolveSetlistEntries({ entries: payload.setlist.entries });
  return {
    performance_label: payload.setlist.performance_label,
    completeness: payload.setlist.completeness,
    confidence: payload.setlist.confidence,
    notes: payload.setlist.notes,
    published: payload.setlist.published,
    entries: entries.map((entry, index) => ({
      position: index + 1, section: entry.section, song_id: entry.song_id, song_title: entry.song_title,
      performed_version_id: entry.performed_version_id, performed_version_title: entry.performed_version_title,
      display_title: entry.display_title, medley_group: entry.medley_group, notes: entry.notes,
    })),
    sources: mergedSources(before, payload, changeSource).map((source) => source.url),
  };
}

function auditStatement(db: D1Database, actor: Actor, requestId: string, action: string, targetType: string, targetId: string, after: unknown, metadata: unknown, createdAt: string, conditionSql = "1", conditionBindings: unknown[] = []): D1PreparedStatement {
  return db.prepare(`INSERT INTO audit_logs (
    id, actor_id, actor_type, channel, action, target_type, target_id, request_id,
    before_json, after_json, metadata_json, created_at
  ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ? WHERE ${conditionSql}`)
    .bind(makeId("aud"), actor.id, actor.type, actor.channel, action, targetType, targetId, requestId, JSON.stringify(after), JSON.stringify(metadata), createdAt, ...conditionBindings);
}

export async function proposeSetlist(db: D1Database, raw: unknown, actor: Actor, requestId = makeId("req")): Promise<ChangeSet> {
  assertScope(actor, "events:draft");
  const input = proposeSetlistSchema.parse(raw);
  const existing = await getChangeSetByKey(db, input.idempotency_key);
  if (existing) return existing;
  const before = input.setlist_id ? await getAdminSetlistById(db, input.setlist_id) : null;
  if (input.setlist_id && !before) throw new ServiceError("not_found", "没有找到歌单", 404);
  const payload: SetlistPayload = {
    setlist_id: before?.id ?? null,
    expected_updated_at: before ? input.expected_updated_at! : null,
    event_id: input.event_id ?? before!.event_id,
    setlist: input.setlist,
  };
  await requireEvent(db, payload.event_id);
  const problems = await blockers(db, payload, before);
  if (problems.length) throw new ServiceError(before && before.updated_at !== payload.expected_updated_at ? "version_conflict" : "invalid_setlist", problems.join("；"), 409);
  // Checks every song and version now, so a proposal that reaches review can be published.
  await afterSnapshot(db, payload, before, input.source_url);

  const id = makeId("chg");
  const createdAt = nowIso();
  const operation = before ? "update" : "create";
  await db.batch([
    db.prepare(`INSERT INTO change_sets (
      id, operation, target_event_id, base_version, payload_json, source_url, reason,
      status, idempotency_key, created_by, created_via, created_at, chat_session_id, subject_type, subject_id
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, 'setlist', ?)`)
      .bind(id, operation, payload.event_id, JSON.stringify(payload), input.source_url, input.reason, input.idempotency_key, actor.id, actor.channel, createdAt, actor.chat_session_id ?? null, payload.setlist_id),
    auditStatement(db, actor, requestId, `change.propose_setlist_${operation}`, "change_set", id, payload, { target_event_id: payload.event_id, setlist_id: payload.setlist_id }, createdAt),
  ]);
  return (await getChangeSet(db, id))!;
}

export async function previewSetlist(db: D1Database, change: ChangeSet): Promise<ChangePreview> {
  const payload = payloadOf(change);
  const event = await requireEvent(db, payload.event_id);
  // Once published the stored setlist is the proposal's own result, so there is nothing left to compare.
  const before = payload.setlist_id && change.status === "proposed" ? await getAdminSetlistById(db, payload.setlist_id) : null;
  const warnings = change.status === "proposed" ? await blockers(db, payload, before) : [`提案当前状态为 ${change.status}，不能再次发布`];
  const setlist: SetlistChangePreview = {
    setlist_id: payload.setlist_id ?? change.subject_id ?? null,
    before: before ? snapshotOf(before) : null,
    after: await afterSnapshot(db, payload, before, change.source_url),
  };
  if (!setlist.after.entries.length) warnings.push("提案中没有曲目");
  return { change, before: event, after: event, setlist, duplicate_candidates: [], warnings, public_path: null };
}

export async function publishSetlist(db: D1Database, change: ChangeSet, actor: Actor, idempotencyKey: string, requestId: string): Promise<EventRecord> {
  const payload = payloadOf(change);
  const event = await requireEvent(db, payload.event_id);
  const before = payload.setlist_id ? await getAdminSetlistById(db, payload.setlist_id) : null;
  const problems = await blockers(db, payload, before);
  if (problems.length) throw new ServiceError("version_conflict", problems.join("；"), 409);
  const operation = before ? "update" : "create";
  await new ContentAdminService(db).saveSetlist({
    id: payload.setlist_id ?? undefined,
    expected_updated_at: payload.expected_updated_at ?? undefined,
    // The setlist save keeps its own receipt; the publish receipt below answers a replay of this call.
    idempotency_key: `${idempotencyKey}:setlist`,
    event_id: payload.event_id,
    ...payload.setlist,
    sources: mergedSources(before, payload, change.source_url),
  }, actor, requestId, ({ id, now, conditionSql, conditionBindings }) => [
    db.prepare(`UPDATE change_sets SET status = 'published', reviewed_by = ?, reviewed_at = ?, published_at = ?, subject_id = ?
      WHERE id = ? AND status = 'proposed' AND ${conditionSql}`).bind(actor.id, now, now, id, change.id, ...conditionBindings),
    auditStatement(db, actor, requestId, `change.publish_setlist_${operation}`, "setlist", id, { setlist_id: id, event_id: payload.event_id },
      { change_set_id: change.id }, now, conditionSql, conditionBindings),
    db.prepare(`INSERT INTO operation_receipts (idempotency_key, operation, result_json, created_at) SELECT ?, 'publish', ?, ? WHERE ${conditionSql}`)
      .bind(idempotencyKey, JSON.stringify(event), now, ...conditionBindings),
  ]);
  return event;
}
