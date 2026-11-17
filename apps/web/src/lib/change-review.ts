import type { CatalogChangePreview, CatalogKind, ChangePreview, ChangeSet, EventLocationInput, EventRecord, SetlistChangeEntry, SetlistSnapshot, VenueField } from "@frip-fan/core";

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
  // Audit actions name setlist proposals this way: change.propose_setlist_create.
  setlist_create: "新增歌单",
  setlist_update: "修改歌单",
  song_create: "新增歌曲",
  song_update: "修改歌曲",
  release_create: "新增专辑",
  release_update: "修改专辑",
  tour_create: "新增巡演",
  tour_update: "修改巡演",
};

/** The same operation words mean different things for an event and for the other records. */
export function changeOperationLabel(change: Pick<ChangeSet, "operation" | "subject_type">): string {
  const key = change.subject_type && change.subject_type !== "event" ? `${change.subject_type}_${change.operation}` : change.operation;
  return CHANGE_OPERATION_LABELS[key] ?? change.operation;
}

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
  alias: "显示别名",
  tour_id: "所属巡演",
  tour_stop: "巡演场次名",
} as const;

export type ReviewField = keyof typeof EVENT_FIELD_LABELS;
export const REVIEW_FIELDS = Object.keys(EVENT_FIELD_LABELS) as ReviewField[];

export const EVENT_STATUS_LABELS: Record<string, string> = {
  scheduled: "预定",
  completed: "已结束",
  cancelled: "已取消",
  postponed: "延期",
};

export const LOCATION_MODE_LABELS: Record<string, string> = {
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
export function formatFieldValue(field: ReviewField, value: unknown, tourNames: ReadonlyMap<string, string> = new Map()): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "tour_id") return tourNames.get(String(value)) ?? String(value);
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
export function changedFields(before: Partial<EventRecord> | null, after: Partial<EventRecord>, tourNames?: ReadonlyMap<string, string>): FieldChange[] {
  return REVIEW_FIELDS
    .filter((field) => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after[field] ?? null))
    .map((field) => ({
      field,
      label: EVENT_FIELD_LABELS[field],
      before: before ? formatFieldValue(field, before[field], tourNames) : "—",
      after: formatFieldValue(field, after[field], tourNames),
    }));
}

const VENUE_FIELD_LABELS: Record<VenueField, string> = {
  canonical_name: "场馆名称",
  administrative_area_id: "场馆行政区",
  address_text: "场馆地址",
  latitude: "场馆纬度",
  longitude: "场馆经度",
  coordinate_precision: "坐标精度",
  coordinate_source: "坐标来源",
};

export type ReviewRow = Pick<FieldChange, "label" | "before" | "after">;

const SETLIST_SECTION_LABELS: Record<string, string> = { main: "本篇", encore: "Encore", double_encore: "Double encore", opening: "Opening", other: "其他" };
const SETLIST_VALUE_LABELS: Record<string, string> = {
  complete: "完整", partial: "部分", unknown: "未知", official: "官方", reported: "报道", unverified: "待核实",
};
const SETLIST_FIELDS = [
  ["performance_label", "场次"], ["completeness", "完整度"], ["confidence", "可信度"], ["notes", "歌单备注"], ["published", "公开"],
] as const;

function setlistValue(field: (typeof SETLIST_FIELDS)[number][0], snapshot: SetlistSnapshot | null): string {
  if (!snapshot) return "—";
  const value = snapshot[field];
  if (field === "published") return value ? "公开" : "不公开";
  return value ? SETLIST_VALUE_LABELS[String(value)] ?? String(value) : "—";
}

/** Setlist attributes that would change, plus one line for how the song list moves. */
function setlistRows(setlist: NonNullable<ChangePreview["setlist"]>): ReviewRow[] {
  const { before, after } = setlist;
  const rows: ReviewRow[] = SETLIST_FIELDS
    .map(([field, label]) => ({ label, before: setlistValue(field, before), after: setlistValue(field, after) }))
    .filter((row) => !before || row.before !== row.after);
  const keys = (snapshot: SetlistSnapshot | null) => (snapshot?.entries ?? []).map(entryKey).join("\n");
  if (!before || keys(before) !== keys(after)) {
    rows.push({ label: "曲目", before: before ? `${before.entries.length} 首` : "—", after: `${after.entries.length} 首` });
  }
  const added = after.sources.filter((url) => !before?.sources.includes(url));
  // Sources are only ever added, so nothing is shown as replaced.
  if (added.length) rows.push({ label: "新增来源", before: "—", after: added.map((url) => url.replace(/^https?:\/\//, "")).join("\n") });
  return rows;
}

function entryKey(entry: SetlistChangeEntry): string {
  return [entry.song_id, entry.performed_version_id ?? "", entry.section, entry.display_title, entry.medley_group ?? "", entry.notes ?? ""].join("\u001f");
}

export interface SetlistLine { position: number; text: string; detail: string; changed: boolean }

/**
 * The two song lists side by side. A line is marked when the other list has no identical entry,
 * so a reorder alone marks nothing and an inserted or edited song stands out.
 */
export function setlistLines(setlist: NonNullable<ChangePreview["setlist"]>): { before: SetlistLine[]; after: SetlistLine[] } {
  const lines = (snapshot: SetlistSnapshot | null, other: SetlistSnapshot | null): SetlistLine[] => {
    const remaining = new Map<string, number>();
    for (const entry of other?.entries ?? []) remaining.set(entryKey(entry), (remaining.get(entryKey(entry)) ?? 0) + 1);
    return (snapshot?.entries ?? []).map((entry) => {
      const key = entryKey(entry);
      const matched = (remaining.get(key) ?? 0) > 0;
      if (matched) remaining.set(key, remaining.get(key)! - 1);
      const detail = [
        entry.section === "main" ? "" : SETLIST_SECTION_LABELS[entry.section] ?? entry.section,
        entry.medley_group ? `Medley ${entry.medley_group}` : "",
        entry.notes ?? "",
      ].filter(Boolean).join(" · ");
      return { position: entry.position, text: entry.display_title, detail, changed: Boolean(other) && !matched };
    });
  };
  return { before: lines(setlist.before, setlist.after), after: lines(setlist.after, setlist.before) };
}

export const CATALOG_NOUNS: Record<CatalogKind, string> = { song: "歌曲", release: "专辑", tour: "巡演" };
const RELEASE_TYPE_LABELS: Record<string, string> = { album: "专辑", single: "单曲", ep: "EP", compilation: "精选集", video: "影像", other: "其他" };
const CATALOG_FIELDS: Record<CatalogKind, Array<[string, string]>> = {
  song: [
    ["title", "标题"], ["original_artist", "原唱"], ["first_release_date", "首次发行"], ["phases", "时期"], ["slug", "Slug"],
    ["notes", "备注"], ["published", "公开"], ["aliases", "别名"], ["versions", "版本"], ["sources", "来源"],
  ],
  release: [
    ["title", "标题"], ["release_type", "类型"], ["release_date", "发行日"], ["catalog_number", "品番"], ["edition", "版本"],
    ["slug", "Slug"], ["notes", "备注"], ["published", "公开"], ["cover_url", "封面"], ["cover_source_url", "封面来源"],
    ["aliases", "别名"], ["apple_music_album_id", "Apple Music 专辑"], ["apple_music_storefront", "Apple Music 区域"],
    ["tracks", "曲目"], ["sources", "来源"],
  ],
  tour: [["name", "名称"], ["slug", "Slug"], ["notes", "备注"], ["published", "公开"]],
};

type Item = Record<string, unknown>;
const parts = (values: unknown[]) => values.filter((value) => value !== null && value !== undefined && value !== "").join(" · ");

/** One line per list item, written so that any edit a reviewer should see changes the line. */
function catalogLines(field: string, value: unknown): string[] {
  const items = Array.isArray(value) ? value as Array<Item | string | number> : [];
  if (field === "versions") return (items as Item[]).map((version) => parts([
    `${String(version.title)}${version.version_label ? `（${String(version.version_label)}）` : ""}`, version.artist_credit, version.release_date,
    version.published ? "" : "不公开", version.notes, ...((version.sources ?? []) as Item[]).map((source) => String(source.url).replace(/^https?:\/\//, "")),
  ]));
  if (field === "tracks") return (items as Item[]).map((track) => parts([
    `${String(track.disc_number)}-${String(track.track_number).padStart(2, "0")} ${String(track.display_title)}`, track.notes,
    track.apple_music_track_id ? `Apple Music ${String(track.apple_music_track_id)}` : "",
    track.youtube_video_id ? `YouTube ${String(track.youtube_video_id)}` : "",
  ]));
  if (field === "sources") return (items as Item[]).map((source) => String(source.url).replace(/^https?:\/\//, ""));
  return items.map(String);
}

function catalogScalar(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "published") return value ? "公开" : "不公开";
  if (field === "release_type") return RELEASE_TYPE_LABELS[String(value)] ?? String(value);
  if (field === "phases") return (value as number[]).length ? (value as number[]).map((phase) => `第 ${phase} 期`).join("、") : "—";
  return String(value);
}

/**
 * Fields of a song, release or tour that would change. A list shows only the lines that differ,
 * so one edited track in a long album does not bury itself among the unchanged ones.
 */
export function catalogRows(catalog: CatalogChangePreview): ReviewRow[] {
  const { before, after } = catalog;
  const rows: ReviewRow[] = [];
  for (const [field, label] of CATALOG_FIELDS[catalog.kind]) {
    const was = before?.[field] ?? null, next = after[field] ?? null;
    if (JSON.stringify(was) === JSON.stringify(next)) continue;
    if (!before && Array.isArray(next) && !next.length) continue;
    if (!Array.isArray(next) || field === "phases") {
      rows.push({ label, before: before ? catalogScalar(field, was) : "—", after: catalogScalar(field, next) });
      continue;
    }
    const lines = { before: catalogLines(field, was), after: catalogLines(field, next) };
    if (!before) { rows.push({ label: `${label}（${lines.after.length}）`, before: "—", after: lines.after.join("\n") || "—" }); continue; }
    const removed = lines.before.filter((line) => !lines.after.includes(line));
    const added = lines.after.filter((line) => !lines.before.includes(line));
    const reordered = !removed.length && !added.length;
    rows.push({
      label: `${label}（${lines.before.length} → ${lines.after.length}）`,
      before: reordered ? "顺序或未显示的细节有变化" : removed.join("\n") || "—",
      after: reordered ? "顺序或未显示的细节有变化" : added.join("\n") || "—",
    });
  }
  return rows;
}

/** Every row a reviewer has to approve: event fields, then edits to venue records, a setlist or a catalog record. */
export function reviewRows(preview: Pick<ChangePreview, "before" | "after" | "venue_changes" | "setlist" | "catalog">, tourNames?: ReadonlyMap<string, string>): ReviewRow[] {
  // The venue is named only when a proposal edits several, to keep the usual single-venue rows short.
  const several = (preview.venue_changes?.length ?? 0) > 1;
  return [
    ...changedFields(preview.before, preview.after, tourNames).map(({ label, before, after }) => ({ label, before, after })),
    ...(preview.venue_changes ?? []).flatMap((change) => change.fields.map((item) => ({
      label: several ? `${VENUE_FIELD_LABELS[item.field]} · ${change.canonical_name}` : VENUE_FIELD_LABELS[item.field],
      before: String(item.before_label ?? item.before ?? "—"),
      after: String(item.after_label ?? item.after ?? "—"),
    }))),
    ...(preview.setlist ? setlistRows(preview.setlist) : []),
    ...(preview.catalog ? catalogRows(preview.catalog) : []),
  ];
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
  if (change.subject_type === "song" || change.subject_type === "release" || change.subject_type === "tour") {
    try {
      const input = (JSON.parse(change.payload_json) as { input?: { title?: string; name?: string; release_date?: string | null } }).input;
      const title = input?.title ?? input?.name;
      if (title) return { title, date: input?.release_date ?? null, eventId: null };
    } catch { /* fall through to the reason */ }
  } else if (change.operation === "create") {
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
    const payload = JSON.parse(change.payload_json) as { patch?: { sources?: Array<{ url?: string }> }; event?: { sources?: Array<{ url?: string }> }; kind?: string };
    // A catalog proposal lists its sources as a diff row; here they would read as all newly added.
    if (!payload.kind) for (const source of payload.patch?.sources ?? payload.event?.sources ?? []) if (source.url) urls.add(source.url);
  } catch { /* malformed payloads still show the change source */ }
  return [...urls];
}
