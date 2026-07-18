import {
  eventDraftSchema,
  eventPatchSchema,
  proposeCreateSchema,
  proposeLifecycleSchema,
  proposeStatusSchema,
  proposeUpdateSchema,
  type ChangeOperation,
  type EventDraft,
  type EventPatch,
  type SourceInput
} from "./schema";
import { findDuplicates, getChangeSet, getChangeSetByKey, getEventById, requireEvent } from "./repository";
import type { Actor, ChangePreview, ChangeSet, EventRecord, EventSource } from "./types";
import { assertScope, createEventSlug, makeId, nowIso, ServiceError } from "./utils";

type NormalizedDraft = Omit<EventDraft, "slug" | "end_date" | "start_time" | "end_time" | "classification" | "venue" | "region" | "remark"> & {
  id: string;
  slug: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  classification: string | null;
  venue: string | null;
  region: string | null;
  remark: string | null;
};
type CreatePayload = { event: NormalizedDraft };
type UpdatePayload = { patch: EventPatch };
type StatusPayload = { status: EventRecord["status"] };

function cleanNullable(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function normalizeDraft(input: EventDraft, id: string): CreatePayload["event"] {
  return {
    ...input,
    id,
    slug: input.slug ?? createEventSlug(input.start_date, input.title, id),
    end_date: input.end_date ?? null,
    start_time: input.start_time ?? null,
    end_time: input.end_time ?? null,
    classification: cleanNullable(input.classification),
    venue: cleanNullable(input.venue),
    region: cleanNullable(input.region),
    remark: cleanNullable(input.remark)
  };
}

function previewSources(sources: SourceInput[], eventId: string): EventSource[] {
  return sources.map((source, index) => ({
    ...source,
    id: `preview-${index}`,
    event_id: eventId,
    verified_at: null,
    created_at: "preview",
    created_by: "preview"
  }));
}

export class ChangeService {
  constructor(private readonly db: D1Database) {}

  async proposeCreate(raw: unknown, actor: Actor, requestId = makeId("req")): Promise<ChangeSet> {
    assertScope(actor, "events:draft");
    const input = proposeCreateSchema.parse(raw);
    const existing = await getChangeSetByKey(this.db, input.idempotency_key);
    if (existing) return existing;
    const id = makeId("chg");
    const eventId = makeId("evt");
    const payload: CreatePayload = { event: normalizeDraft(input.event, eventId) };
    const createdAt = nowIso();
    await this.db.batch([
      this.db.prepare(`INSERT INTO change_sets (
        id, operation, target_event_id, base_version, payload_json, source_url, reason,
        status, idempotency_key, created_by, created_via, created_at
      ) VALUES (?, 'create', NULL, NULL, ?, ?, ?, 'proposed', ?, ?, ?, ?)`)
        .bind(id, JSON.stringify(payload), input.source_url ?? input.event.sources[0]?.url ?? null, input.reason, input.idempotency_key, actor.id, actor.channel, createdAt),
      this.auditStatement(actor, requestId, "change.propose_create", "change_set", id, null, payload, { idempotency_key: input.idempotency_key }, createdAt)
    ]);
    return (await getChangeSet(this.db, id))!;
  }

  async proposeUpdate(raw: unknown, actor: Actor, requestId = makeId("req")): Promise<ChangeSet> {
    assertScope(actor, "events:draft");
    const input = proposeUpdateSchema.parse(raw);
    await this.assertBaseVersion(input.target_event_id, input.expected_version);
    return this.createProposal("update", input.target_event_id, input.expected_version, { patch: input.patch }, input.source_url, input.reason, input.idempotency_key, actor, requestId);
  }

  async proposeStatus(raw: unknown, actor: Actor, requestId = makeId("req")): Promise<ChangeSet> {
    assertScope(actor, "events:draft");
    const input = proposeStatusSchema.parse(raw);
    await this.assertBaseVersion(input.target_event_id, input.expected_version);
    return this.createProposal("status_change", input.target_event_id, input.expected_version, { status: input.status }, input.source_url, input.reason, input.idempotency_key, actor, requestId);
  }

  async proposeLifecycle(operation: "unpublish" | "archive" | "restore", raw: unknown, actor: Actor, requestId = makeId("req")): Promise<ChangeSet> {
    assertScope(actor, "events:archive");
    const input = proposeLifecycleSchema.parse(raw);
    await this.assertBaseVersion(input.target_event_id, input.expected_version);
    return this.createProposal(operation, input.target_event_id, input.expected_version, {}, null, input.reason, input.idempotency_key, actor, requestId);
  }

  private async createProposal(
    operation: ChangeOperation,
    targetId: string,
    baseVersion: number,
    payload: object,
    sourceUrl: string | null,
    reason: string,
    idempotencyKey: string,
    actor: Actor,
    requestId: string
  ): Promise<ChangeSet> {
    const existing = await getChangeSetByKey(this.db, idempotencyKey);
    if (existing) return existing;
    const id = makeId("chg");
    const createdAt = nowIso();
    await this.db.batch([
      this.db.prepare(`INSERT INTO change_sets (
        id, operation, target_event_id, base_version, payload_json, source_url, reason,
        status, idempotency_key, created_by, created_via, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`)
        .bind(id, operation, targetId, baseVersion, JSON.stringify(payload), sourceUrl, reason, idempotencyKey, actor.id, actor.channel, createdAt),
      this.auditStatement(actor, requestId, `change.propose_${operation}`, "change_set", id, null, payload, { target_event_id: targetId }, createdAt)
    ]);
    return (await getChangeSet(this.db, id))!;
  }

  async preview(id: string, actor: Actor): Promise<ChangePreview> {
    assertScope(actor, "events:read");
    const change = await getChangeSet(this.db, id);
    if (!change) throw new ServiceError("not_found", "没有找到变更提案", 404);
    let before: EventRecord | null = null;
    let after: Partial<EventRecord>;
    const warnings: string[] = [];

    if (change.operation === "create") {
      const payload = JSON.parse(change.payload_json) as CreatePayload;
      const event = eventDraftSchema.parse(payload.event);
      const normalized = normalizeDraft(event, payload.event.id);
      const { sources, ...fields } = normalized;
      after = { ...fields, sources: previewSources(sources, normalized.id), published: true, version: 1 };
    } else {
      before = await requireEvent(this.db, change.target_event_id!);
      if (before.version !== change.base_version) warnings.push(`版本已变化：提案基于 v${change.base_version}，当前为 v${before.version}`);
      after = this.applyPayload(before, change);
    }

    const candidates = after.title && after.start_date
      ? await findDuplicates(this.db, {
          title: after.title,
          start_date: after.start_date,
          end_date: after.end_date,
          venue: after.venue,
          source_url: change.source_url ?? undefined
        })
      : [];
    const filtered = candidates.filter((candidate) => candidate.event.id !== before?.id);
    if (filtered.length) warnings.push(`发现 ${filtered.length} 个可能重复的活动`);
    if (change.status !== "proposed") warnings.push(`提案当前状态为 ${change.status}，不能再次发布`);
    return {
      change,
      before,
      after,
      duplicate_candidates: filtered,
      warnings,
      public_path: after.slug ? `/events/${after.slug}` : null
    };
  }

  async publish(id: string, actor: Actor, idempotencyKey: string, requestId = makeId("req")): Promise<EventRecord> {
    assertScope(actor, "events:publish");
    const receipt = await this.db.prepare("SELECT result_json FROM operation_receipts WHERE idempotency_key = ?").bind(idempotencyKey).first<{ result_json: string }>();
    if (receipt) {
      const saved = JSON.parse(receipt.result_json) as EventRecord;
      return (await getEventById(this.db, saved.id)) ?? saved;
    }
    const change = await getChangeSet(this.db, id);
    if (!change) throw new ServiceError("not_found", "没有找到变更提案", 404);
    if (change.status !== "proposed") throw new ServiceError("invalid_state", `提案状态为 ${change.status}，不能发布`, 409);

    return change.operation === "create"
      ? this.publishCreate(change, actor, idempotencyKey, requestId)
      : this.publishExisting(change, actor, idempotencyKey, requestId);
  }

  private async publishCreate(change: ChangeSet, actor: Actor, idempotencyKey: string, requestId: string): Promise<EventRecord> {
    const payload = JSON.parse(change.payload_json) as CreatePayload;
    const parsed = eventDraftSchema.parse(payload.event);
    const event = normalizeDraft(parsed, payload.event.id);
    const now = nowIso();
    const { sources: inputSources, ...eventFields } = event;
    const result: EventRecord = {
      ...eventFields,
      published: true,
      version: 1,
      created_at: now,
      updated_at: now,
      published_at: now,
      archived_at: null,
      sources: []
    };
    const statements: D1PreparedStatement[] = [
      this.db.prepare(`INSERT INTO events (
        id, slug, title, start_date, end_date, start_time, end_time, timezone, category,
        classification, venue, region, remark, status, published, version, created_at,
        updated_at, published_at, archived_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, NULL
        WHERE EXISTS (SELECT 1 FROM change_sets WHERE id = ? AND status = 'proposed')`)
        .bind(event.id, event.slug, event.title, event.start_date, event.end_date, event.start_time, event.end_time, event.timezone, event.category, event.classification, event.venue, event.region, event.remark, event.status, now, now, now, change.id)
    ];
    for (const source of inputSources) statements.push(this.insertSourceStatement(event.id, source, actor.id, now, now));
    statements.push(
      this.db.prepare("UPDATE change_sets SET status = 'published', reviewed_by = ?, reviewed_at = ?, published_at = ? WHERE id = ? AND status = 'proposed'").bind(actor.id, now, now, change.id),
      this.auditConditionalStatement(actor, requestId, "change.publish_create", "event", event.id, null, result, { change_set_id: change.id }, now, event.id, now),
      this.db.prepare("INSERT INTO operation_receipts (idempotency_key, operation, result_json, created_at) SELECT ?, 'publish', ?, ? WHERE EXISTS (SELECT 1 FROM events WHERE id = ? AND updated_at = ?)").bind(idempotencyKey, JSON.stringify(result), now, event.id, now)
    );
    const batch = await this.db.batch(statements);
    if ((batch[0].meta.changes ?? 0) !== 1) throw new ServiceError("conflict", "提案已变化，未执行发布", 409);
    return (await requireEvent(this.db, event.id));
  }

  private async publishExisting(change: ChangeSet, actor: Actor, idempotencyKey: string, requestId: string): Promise<EventRecord> {
    const before = await requireEvent(this.db, change.target_event_id!);
    if (before.version !== change.base_version) {
      throw new ServiceError("version_conflict", `活动当前为 v${before.version}，提案基于 v${change.base_version}`, 409, { current: before });
    }
    const after = this.applyPayload(before, change) as EventRecord;
    const now = nowIso();
    after.version = before.version + 1;
    after.updated_at = now;
    const update = this.db.prepare(`UPDATE events SET
      slug = ?, title = ?, start_date = ?, end_date = ?, start_time = ?, end_time = ?, timezone = ?,
      category = ?, classification = ?, venue = ?, region = ?, remark = ?, status = ?, published = ?,
      version = version + 1, updated_at = ?, published_at = ?, archived_at = ?
      WHERE id = ? AND version = ?`)
      .bind(after.slug, after.title, after.start_date, after.end_date, after.start_time, after.end_time, after.timezone, after.category, after.classification, after.venue, after.region, after.remark, after.status, after.published ? 1 : 0, now, after.published_at, after.archived_at, before.id, before.version);
    const statements: D1PreparedStatement[] = [update];
    const payload = JSON.parse(change.payload_json) as UpdatePayload;
    if (change.operation === "update" && payload.patch.sources) {
      for (const source of payload.patch.sources) statements.push(this.insertSourceStatement(before.id, source, actor.id, now, now));
    }
    if (change.source_url) {
      statements.push(this.insertSourceStatement(before.id, { url: change.source_url, label: "Change source", source_type: "official" }, actor.id, now, now));
    }
    statements.push(
      this.db.prepare("UPDATE change_sets SET status = 'published', reviewed_by = ?, reviewed_at = ?, published_at = ? WHERE id = ? AND status = 'proposed' AND EXISTS (SELECT 1 FROM events WHERE id = ? AND updated_at = ?)").bind(actor.id, now, now, change.id, before.id, now),
      this.auditConditionalStatement(actor, requestId, `change.publish_${change.operation}`, "event", before.id, before, after, { change_set_id: change.id }, now, before.id, now),
      this.db.prepare("INSERT INTO operation_receipts (idempotency_key, operation, result_json, created_at) SELECT ?, 'publish', ?, ? WHERE EXISTS (SELECT 1 FROM events WHERE id = ? AND updated_at = ?)").bind(idempotencyKey, JSON.stringify(after), now, before.id, now)
    );
    const batch = await this.db.batch(statements);
    if ((batch[0].meta.changes ?? 0) !== 1) throw new ServiceError("version_conflict", "活动在发布时发生变化，请重新预览", 409);
    return requireEvent(this.db, before.id);
  }

  async discard(id: string, actor: Actor, requestId = makeId("req")): Promise<ChangeSet> {
    assertScope(actor, "events:draft");
    const before = await getChangeSet(this.db, id);
    if (!before) throw new ServiceError("not_found", "没有找到变更提案", 404);
    if (before.status !== "proposed") throw new ServiceError("invalid_state", `提案状态为 ${before.status}，不能丢弃`, 409);
    const now = nowIso();
    const results = await this.db.batch([
      this.db.prepare("UPDATE change_sets SET status = 'discarded', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'proposed'").bind(actor.id, now, id),
      this.db.prepare(`INSERT INTO audit_logs (
        id, actor_id, actor_type, channel, action, target_type, target_id, request_id,
        before_json, after_json, metadata_json, created_at
      ) SELECT ?, ?, ?, ?, 'change.discard', 'change_set', ?, ?, ?, ?, NULL, ?
        WHERE EXISTS (SELECT 1 FROM change_sets WHERE id = ? AND status = 'discarded' AND reviewed_at = ?)`)
        .bind(makeId("aud"), actor.id, actor.type, actor.channel, id, requestId, JSON.stringify(before), JSON.stringify({ ...before, status: "discarded" }), now, id, now)
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) throw new ServiceError("conflict", "提案已被其他操作处理", 409);
    return (await getChangeSet(this.db, id))!;
  }

  private applyPayload(before: EventRecord, change: ChangeSet): EventRecord {
    const after: EventRecord = { ...before, sources: before.sources ? [...before.sources] : [] };
    if (change.operation === "update") {
      const payload = JSON.parse(change.payload_json) as UpdatePayload;
      const patch = eventPatchSchema.parse(payload.patch);
      const { sources: sourcePatch, ...fields } = patch;
      Object.assign(after, fields);
      if (after.end_date && after.end_date < after.start_date) throw new ServiceError("invalid_date_range", "结束日期不能早于开始日期");
      if (sourcePatch?.length) after.sources = [...(after.sources ?? []), ...sourcePatch.map((source) => ({ ...source, id: "preview", event_id: before.id, verified_at: null, created_at: "preview", created_by: "preview" }))];
    } else if (change.operation === "status_change") {
      after.status = (JSON.parse(change.payload_json) as StatusPayload).status;
    } else if (change.operation === "unpublish") {
      after.published = false;
    } else if (change.operation === "archive") {
      after.archived_at = nowIso();
    } else if (change.operation === "restore") {
      after.archived_at = null;
    }
    return after;
  }

  private async assertBaseVersion(id: string, version: number): Promise<void> {
    const event = await requireEvent(this.db, id);
    if (event.version !== version) throw new ServiceError("version_conflict", `活动当前为 v${event.version}，请求基于 v${version}`, 409, { current: event });
  }

  private insertSourceStatement(eventId: string, source: SourceInput, actorId: string, verifiedAt: string, createdAt: string): D1PreparedStatement {
    return this.db.prepare(`INSERT OR IGNORE INTO event_sources (
      id, event_id, url, label, source_type, verified_at, created_at, created_by
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM events WHERE id = ? AND updated_at = ?)`)
      .bind(makeId("src"), eventId, source.url, source.label ?? null, source.source_type ?? "official", verifiedAt, createdAt, actorId, eventId, createdAt);
  }

  private auditStatement(actor: Actor, requestId: string, action: string, targetType: string, targetId: string, before: unknown, after: unknown, metadata: unknown, createdAt: string): D1PreparedStatement {
    return this.db.prepare(`INSERT INTO audit_logs (
      id, actor_id, actor_type, channel, action, target_type, target_id, request_id,
      before_json, after_json, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(makeId("aud"), actor.id, actor.type, actor.channel, action, targetType, targetId, requestId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, metadata ? JSON.stringify(metadata) : null, createdAt);
  }

  private auditConditionalStatement(actor: Actor, requestId: string, action: string, targetType: string, targetId: string, before: unknown, after: unknown, metadata: unknown, createdAt: string, eventId: string, eventUpdatedAt: string): D1PreparedStatement {
    return this.db.prepare(`INSERT INTO audit_logs (
      id, actor_id, actor_type, channel, action, target_type, target_id, request_id,
      before_json, after_json, metadata_json, created_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM events WHERE id = ? AND updated_at = ?)`)
      .bind(makeId("aud"), actor.id, actor.type, actor.channel, action, targetType, targetId, requestId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, metadata ? JSON.stringify(metadata) : null, createdAt, eventId, eventUpdatedAt);
  }
}
