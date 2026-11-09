import type { ChangeSet, EventLocationInput, EventRecord } from "@frip-fan/core";

export const CHANGE_STATUS_LABELS: Record<string, string> = {
  proposed: "待处理",
  published: "已发布",
  discarded: "已丢弃",
  failed: "失败",
};

export const CHANGE_OPERATION_LABELS: Record<string, string> = {
  create: "新增活动",
  update: "修改活动",
  status_change: "变更状态",
  unpublish: "取消公开",
  archive: "归档",
  restore: "恢复",
};

export const EVENT_FIELD_LABELS = {
  title: "标题",
  slug: "Slug",
  start_date: "开始日期",
  end_date: "结束日期",
  start_time: "开始时间",
  end_time: "结束时间",
  timezone: "时区",
  category: "类别",
  classification: "分类",
  location_mode: "地点形式",
  location_note: "地点备注",
  remark: "备注",
  status: "状态",
  published: "公开",
  archived_at: "归档时间",
} as const;

export type ReviewField = keyof typeof EVENT_FIELD_LABELS;
export const REVIEW_FIELDS = Object.keys(EVENT_FIELD_LABELS) as ReviewField[];

const EVENT_STATUS_LABELS: Record<string, string> = {
  scheduled: "预定",
  completed: "已结束",
  cancelled: "已取消",
  postponed: "延期",
};

const LOCATION_MODE_LABELS: Record<string, string> = {
  none: "无地点",
  physical: "线下",
  online: "线上",
  broadcast: "播出",
  hybrid: "线下 + 线上",
  multiple: "多个地点",
  undisclosed: "未公开",
  unknown: "未知",
};

const VENUE_ROLE_LABELS: Record<string, string> = {
  primary: "主会场",
  secondary: "副会场",
  broadcast_origin: "播出源",
};

/** Human-readable value for the review table; empty values render as an em dash. */
export function formatFieldValue(field: ReviewField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "published") return value ? "公开" : "不公开";
  if (field === "status") return EVENT_STATUS_LABELS[String(value)] ?? String(value);
  if (field === "location_mode") return LOCATION_MODE_LABELS[String(value)] ?? String(value);
  if (field === "archived_at") return String(value).slice(0, 16).replace("T", " ");
  return String(value);
}

export interface FieldChange {
  field: ReviewField;
  label: string;
  before: string;
  after: string;
}

/** Fields whose stored value differs; a create compares against nothing and lists every filled field. */
export function changedFields(before: Partial<EventRecord> | null, after: Partial<EventRecord>): FieldChange[] {
  return REVIEW_FIELDS
    .filter((field) => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after[field] ?? null))
    .map((field) => ({
      field,
      label: EVENT_FIELD_LABELS[field],
      before: before ? formatFieldValue(field, before[field]) : "—",
      after: formatFieldValue(field, after[field]),
    }));
}

/** One line per venue/channel so location edits read as a list instead of raw JSON. */
export function describeLocation(location: EventLocationInput | null, venueNames: ReadonlyMap<string, string> = new Map()): string[] {
  if (!location) return [];
  const lines = [LOCATION_MODE_LABELS[location.location_mode] ?? location.location_mode];
  for (const venue of [...location.venues].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    const name = venue.display_name_snapshot || venue.canonical_name || (venue.venue_id ? venueNames.get(venue.venue_id) ?? venue.venue_id : "未命名场地");
    lines.push(`${VENUE_ROLE_LABELS[venue.role ?? "primary"] ?? venue.role}：${name}`);
  }
  for (const channel of location.channels) lines.push(`频道：${channel.name}${channel.url ? `（${channel.url}）` : ""}`);
  if (location.location_note) lines.push(`备注：${location.location_note}`);
  return lines;
}

export function locationOfEvent(event: EventRecord | null): EventLocationInput | null {
  if (!event) return null;
  return {
    location_mode: event.location_mode,
    location_note: event.location_note,
    venues: (event.venues ?? []).map((venue) => ({
      venue_id: venue.id,
      canonical_name: venue.canonical_name,
      display_name_snapshot: venue.display_name_snapshot,
      role: venue.role,
      position: venue.position,
    })),
    channels: (event.channels ?? []).map((channel) => ({
      channel_type: channel.channel_type,
      name: channel.name,
      url: channel.url,
      position: channel.position,
    })),
  };
}

export interface ChangeHeadline {
  title: string;
  date: string | null;
  eventId: string | null;
}

/** Which event a proposal is about, read from the joined target or the create payload. */
export function changeHeadline(change: ChangeSet, target?: Pick<EventRecord, "id" | "title" | "start_date"> | null): ChangeHeadline {
  if (target) return { title: target.title, date: target.start_date, eventId: target.id };
  if (change.operation === "create") {
    try {
      const event = (JSON.parse(change.payload_json) as { event?: { title?: string; start_date?: string } }).event;
      if (event?.title) return { title: event.title, date: event.start_date ?? null, eventId: null };
    } catch { /* fall through to the reason */ }
  }
  return { title: change.reason || change.id, date: null, eventId: change.target_event_id };
}

/** A proposal built on an older event version can no longer be published as-is. */
export function isStale(change: Pick<ChangeSet, "status" | "base_version">, targetVersion: number | null | undefined): boolean {
  return change.status === "proposed" && change.base_version !== null && targetVersion !== null && targetVersion !== undefined && change.base_version !== targetVersion;
}

export function formatTimestamp(value: string | null | undefined): string {
  return value ? value.slice(0, 16).replace("T", " ") : "—";
}

/** Sources a publish would attach: the proposal's own source plus any listed in an update patch. */
export function proposedSources(change: ChangeSet): string[] {
  const urls = new Set<string>();
  if (change.source_url) urls.add(change.source_url);
  try {
    const payload = JSON.parse(change.payload_json) as { patch?: { sources?: Array<{ url?: string }> }; event?: { sources?: Array<{ url?: string }> } };
    for (const source of payload.patch?.sources ?? payload.event?.sources ?? []) if (source.url) urls.add(source.url);
  } catch { /* malformed payloads still show the change source */ }
  return [...urls];
}
