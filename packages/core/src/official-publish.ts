import { ChangeService } from "./change-service";
import { getChangeSetByKey, getEventById } from "./repository";
import type { Actor, ChangeSet, EventRecord } from "./types";
import type { SyncAction } from "./official-sync-schema";
import { officialUrl, verifyEvidence } from "./official-source";
import { distinctOccurrence, sameActivityTitle } from "./sync-policy";

export const syncActor: Actor = {
  id: "official-sync-agent", type: "ai", channel: "import",
  scopes: ["events:read", "events:draft", "events:publish"],
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}

export async function actionKey(action: SyncAction): Promise<string> {
  // Reasons, quotations and confidence can vary across reads of the same fact.
  const { reason: _reason, evidence_quote: _quote, evidence_refs: _refs, source_revision: _revision, needs_review: _review, ...fact } = action;
  fact.source_url = officialUrl(fact.source_url);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stable(fact))));
  return `official-sync:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export interface ActionOutcome {
  status: "published" | "review" | "unchanged" | "blocked";
  change_id?: string;
  event_id?: string;
  code?: string;
}

export async function applyAction(
  db: D1Database, action: SyncAction, checkedUrls: string[], autoPublish: boolean,
  verify: typeof verifyEvidence = verifyEvidence, actor: Actor = syncActor,
  knownChange?: ChangeSet,
): Promise<ActionOutcome> {
  const source = officialUrl(action.source_url);
  if (!checkedUrls.some((url) => { try { return officialUrl(url) === source; } catch { return false; } })) {
    return { status: "blocked", code: "source_not_read" };
  }
  const key = await actionKey(action);
  const service = new ChangeService(db);
  let change = knownChange ?? await getChangeSetByKey(db, key);
  if (change && change.created_by !== actor.id) return { status: "blocked", code: "foreign_proposal" };
  if (change?.status === "published") return { status: "unchanged", change_id: change.id };
  if (change && change.status !== "proposed") return { status: "blocked", change_id: change.id, code: "proposal_closed" };

  if (!change) {
    if (action.operation === "create") {
      if (!action.event.sources.some((item) => officialUrl(item.url) === source)) return { status: "blocked", code: "missing_event_source" };
      for (const item of action.event.sources) officialUrl(item.url);
      change = await service.proposeCreate({ ...action, source_url: source, idempotency_key: key }, actor);
    } else {
      const before = await getEventById(db, action.target_event_id);
      if (!before || before.archived_at || !before.published) return { status: "blocked", code: "target_not_public" };
      if (before.version !== action.expected_version) return { status: "blocked", code: "version_conflict" };
      if (action.operation === "update") {
        if (action.patch.slug !== undefined) return { status: "blocked", code: "slug_change_forbidden" };
        if (Object.entries(action.patch).every(([field, value]) => JSON.stringify(stable(value)) === JSON.stringify(stable(before[field as keyof EventRecord])))) {
          return { status: "unchanged", event_id: before.id };
        }
        // Never drop curated sources or permit the model to insert unrelated sources.
        if (action.patch.sources) {
          const existing = new Set(before.sources?.map((item) => item.url));
          if (action.patch.sources.some((item) => !existing.has(item.url) && officialUrl(item.url) !== source)) {
            return { status: "blocked", code: "unrelated_source" };
          }
          action = { ...action, patch: { ...action.patch, sources: [
            ...(before.sources ?? []).map(({ url, label, source_type }) => ({ url, label: label ?? undefined, source_type: source_type ?? undefined })),
            ...action.patch.sources.filter((item) => !existing.has(item.url)),
          ] } };
        } else {
          action = { ...action, patch: { ...action.patch, sources: [
            ...(before.sources ?? []).map(({ url, label, source_type }) => ({ url, label: label ?? undefined, source_type: source_type ?? undefined })),
            ...((before.sources ?? []).some((item) => item.url === source) ? [] : [{ url: source, source_type: "official" }]),
          ] } };
        }
        change = await service.proposeUpdate({ ...action, source_url: source, idempotency_key: key }, actor);
      } else {
        if (before.status === action.status) return { status: "unchanged", event_id: before.id };
        change = await service.proposeStatus({ ...action, source_url: source, idempotency_key: key }, actor);
      }
    }
  }
  const preview = await service.preview(change.id, actor);
  if (action.operation === "create" && !preview.warnings.length) {
    const possible = await db.prepare(`SELECT title,category,location_mode FROM events WHERE archived_at IS NULL
      AND start_date <= ? AND COALESCE(end_date, start_date) >= ? LIMIT 201`)
      .bind(action.event.end_date ?? action.event.start_date, action.event.start_date).all<{ title: string; category: string; location_mode: string }>();
    if (possible.results.length > 200 || possible.results.some((event) => !distinctOccurrence(action.event, event) && sameActivityTitle(event.title, action.event.title))) {
      return { status: "review", change_id: change.id, code: "normalized_duplicate" };
    }
  }
  let verified = false;
  if (autoPublish && !action.needs_review && !preview.warnings.length) {
    try { verified = await verify(source, action.evidence_quote); } catch { /* Leave proposal for review. */ }
  }
  if (!autoPublish || action.needs_review || preview.warnings.length || !verified) {
    return { status: "review", change_id: change.id,
      code: preview.warnings.length ? "preview_warning" : !autoPublish ? "draft_mode" : action.needs_review ? "uncertain" : "evidence_unverified" };
  }
  const event = await service.publish(change.id, actor, `${key}:publish`);
  return { status: "published", change_id: change.id, event_id: event.id };
}
