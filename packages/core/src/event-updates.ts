/**
 * What changed about an event recently, for the "just announced / updated" badges.
 *
 * Only edits count. A bulk archive import rewrites hundreds of rows at once and lands in the
 * audit log as `event.import`, so reading `events.updated_at` would announce a 2005 show as
 * freshly updated; the actions below are the ones a person or the official sync made.
 */
export type EventUpdateKind = "new" | "status" | "time" | "venue" | "details";

export interface EventUpdateHighlight {
  event_id: string;
  kind: EventUpdateKind;
  changed_at: string;
}

export interface EventAuditRow {
  target_id: string;
  action: string;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

/** Days a new announcement or an edit stays worth flagging on the homepage. */
export const EVENT_UPDATE_WINDOW_DAYS = 30;

const CREATE_ACTIONS = ["event.create", "change.publish_create"];
const UPDATE_ACTIONS = ["event.update", "change.publish_update", "change.publish_status_change"];
const WATCHED_ACTIONS = [...CREATE_ACTIONS, ...UPDATE_ACTIONS];

// Most significant first: a postponement matters more than a corrected remark.
const KIND_ORDER: EventUpdateKind[] = ["new", "status", "time", "venue", "details"];
const FIELD_GROUPS: Array<{ kind: EventUpdateKind; fields: string[] }> = [
  { kind: "status", fields: ["status"] },
  { kind: "time", fields: ["start_date", "end_date", "start_time", "end_time"] },
  { kind: "venue", fields: ["venue", "region"] },
  { kind: "details", fields: ["title", "classification", "remark", "sources_json"] },
];

function changedKinds(row: EventAuditRow): EventUpdateKind[] {
  if (CREATE_ACTIONS.includes(row.action)) return ["new"];
  if (!row.before_json || !row.after_json) return [];
  let before: Record<string, unknown>;
  let after: Record<string, unknown>;
  try {
    before = JSON.parse(row.before_json) as Record<string, unknown>;
    after = JSON.parse(row.after_json) as Record<string, unknown>;
  } catch {
    return [];
  }
  return FIELD_GROUPS
    .filter((group) => group.fields.some((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null)))
    .map((group) => group.kind);
}

/**
 * The most significant change per event, dated by the newest edit that made it. Scanning every
 * row in the window keeps an older postponement visible behind a newer typo fix.
 */
export function summarizeEventUpdates(rows: readonly EventAuditRow[]): Map<string, EventUpdateHighlight> {
  const result = new Map<string, EventUpdateHighlight>();
  const rank = (kind: EventUpdateKind) => KIND_ORDER.indexOf(kind);
  for (const row of rows) {
    for (const kind of changedKinds(row)) {
      const current = result.get(row.target_id);
      if (!current) {
        result.set(row.target_id, { event_id: row.target_id, kind, changed_at: row.created_at });
        continue;
      }
      if (rank(kind) < rank(current.kind)) result.set(row.target_id, { event_id: row.target_id, kind, changed_at: row.created_at });
      else if (kind === current.kind && row.created_at > current.changed_at) current.changed_at = row.created_at;
    }
  }
  return result;
}

/** Recent edits to the given events, keyed by event id. */
export async function listEventUpdates(db: D1Database, eventIds: readonly string[], since: string): Promise<Map<string, EventUpdateHighlight>> {
  const ids = eventIds.filter(Boolean);
  if (ids.length === 0) return new Map();
  const result = await db.prepare(`
    SELECT target_id, action, before_json, after_json, created_at
    FROM audit_logs
    WHERE target_type = 'event'
      AND created_at >= ?
      AND action IN (${WATCHED_ACTIONS.map(() => "?").join(", ")})
      AND target_id IN (${ids.map(() => "?").join(", ")})
    ORDER BY created_at ASC
  `).bind(since, ...WATCHED_ACTIONS, ...ids).all<EventAuditRow>();
  return summarizeEventUpdates(result.results);
}

/** The ISO instant the badge window starts, for a `YYYY-MM-DD` day. */
export function eventUpdateWindowStart(today: string, days = EVENT_UPDATE_WINDOW_DAYS): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString();
}
