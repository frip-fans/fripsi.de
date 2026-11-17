import { z } from "zod";

export const categorySchema = z.enum(["LIVE", "EVENT", "RELEASE", "MEDIA", "OTHER"]);
export const eventStatusSchema = z.enum(["scheduled", "completed", "cancelled", "postponed"]);
export const locationModeSchema = z.enum(["none", "physical", "online", "broadcast", "hybrid", "multiple", "undisclosed", "unknown"]);
export const venueRoleSchema = z.enum(["primary", "secondary", "broadcast_origin"]);
const coordinatePrecisionSchema = z.enum(["entrance", "building", "site", "approximate"]);
export const channelTypeSchema = z.enum(["streaming", "radio", "television", "digital_store", "download", "other"]);
export const changeOperationSchema = z.enum([
  "create",
  "update",
  "status_change",
  "unpublish",
  "archive",
  "restore"
]);
export const changeStatusSchema = z.enum(["proposed", "published", "discarded", "rejected", "failed"]);

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const clockTime = /^([01]\d|2[0-3]):[0-5]\d$/;

export const dateSchema = z.string().regex(isoDate, "日期必须使用 YYYY-MM-DD").refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "日期无效");

export const timeSchema = z.string().regex(clockTime, "时间必须使用 HH:mm");

export const sourceUrlSchema = z.url().max(2048).refine((value) => new URL(value).protocol === "https:", "来源必须使用 HTTPS");

export const sourceInputSchema = z.object({
  url: sourceUrlSchema,
  label: z.string().trim().max(120).optional(),
  source_type: z.string().trim().max(50).optional()
});

export const eventVenueInputSchema = z.object({
  venue_id: z.string().trim().min(1).max(160).optional(),
  canonical_name: z.string().trim().min(1).max(240).optional(),
  administrative_area_id: z.string().trim().min(1).max(160).nullish(),
  address_text: z.string().trim().max(500).nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  coordinate_precision: coordinatePrecisionSchema.nullish(),
  coordinate_source: z.string().trim().max(120).nullish(),
  role: venueRoleSchema.default("primary"),
  position: z.number().int().min(1).max(100).default(1),
  display_name_snapshot: z.string().trim().max(240).nullish(),
}).superRefine((venue, context) => {
  if (!venue.venue_id && !venue.canonical_name) {
    context.addIssue({ code: "custom", path: ["canonical_name"], message: "新场馆必须填写名称" });
  }
  if ((venue.latitude == null) !== (venue.longitude == null)) {
    context.addIssue({ code: "custom", path: ["latitude"], message: "纬度和经度必须同时填写" });
  }
});

export const eventChannelInputSchema = z.object({
  channel_type: channelTypeSchema,
  name: z.string().trim().min(1).max(240),
  url: sourceUrlSchema.nullish(),
  position: z.number().int().min(1).max(100).default(1),
});

function validateLocation(event: {
  location_mode: z.infer<typeof locationModeSchema>;
  venues: z.infer<typeof eventVenueInputSchema>[];
  channels: z.infer<typeof eventChannelInputSchema>[];
}, context: z.RefinementCtx): void {
  if (event.location_mode === "none" && (event.venues.length || event.channels.length)) {
    context.addIssue({ code: "custom", path: ["location_mode"], message: "无地点活动不能关联场馆或渠道" });
  }
  if (event.location_mode === "physical" && event.venues.length !== 1) {
    context.addIssue({ code: "custom", path: ["venues"], message: "实体活动必须关联一个场馆" });
  }
  if (event.location_mode === "multiple" && event.venues.length < 2) {
    context.addIssue({ code: "custom", path: ["venues"], message: "多地点活动至少需要两个场馆" });
  }
  if (event.location_mode === "online" && !event.channels.length) {
    context.addIssue({ code: "custom", path: ["channels"], message: "线上活动至少需要一个渠道" });
  }
  if (event.location_mode === "broadcast" && !event.channels.length) {
    context.addIssue({ code: "custom", path: ["channels"], message: "广播活动至少需要一个渠道" });
  }
  if (event.location_mode === "hybrid" && (!event.venues.length || !event.channels.length)) {
    context.addIssue({ code: "custom", path: ["location_mode"], message: "混合活动必须同时关联场馆和渠道" });
  }
}

export const eventLocationSchema = z.object({
  location_mode: locationModeSchema,
  location_note: z.string().trim().max(1000).nullish().transform((value) => value || null),
  venues: z.array(eventVenueInputSchema).max(20).default([]),
  channels: z.array(eventChannelInputSchema).max(20).default([]),
}).superRefine(validateLocation);

export const eventDraftSchema = z.object({
  slug: z.string().trim().min(3).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug 只能包含小写字母、数字和连字符").optional(),
  title: z.string().trim().min(1).max(240),
  start_date: dateSchema,
  end_date: dateSchema.nullish(),
  start_time: timeSchema.nullish(),
  end_time: timeSchema.nullish(),
  timezone: z.string().trim().min(1).max(80).default("Asia/Tokyo"),
  category: categorySchema,
  classification: z.string().trim().max(120).nullish(),
  location_mode: locationModeSchema,
  location_note: z.string().trim().max(1000).nullish(),
  venues: z.array(eventVenueInputSchema).max(20).default([]),
  channels: z.array(eventChannelInputSchema).max(20).default([]),
  remark: z.string().trim().max(4000).nullish(),
  status: eventStatusSchema.default("scheduled"),
  sources: z.array(sourceInputSchema).min(1, "至少需要一个官方来源").max(10)
}).superRefine((event, context) => {
  if (event.end_date && event.end_date < event.start_date) {
    context.addIssue({ code: "custom", path: ["end_date"], message: "结束日期不能早于开始日期" });
  }
  if (event.end_time && !event.start_time) {
    context.addIssue({ code: "custom", path: ["end_time"], message: "填写结束时间前必须填写开始时间" });
  }
  if (event.end_date && event.end_date === event.start_date && event.start_time && event.end_time && event.end_time < event.start_time) {
    context.addIssue({ code: "custom", path: ["end_time"], message: "同日活动的结束时间不能早于开始时间" });
  }
  validateLocation(event, context);
});

/** Edits to a venue record itself, as opposed to which venues an event links to. */
/**
 * Edits to a venue record itself, as opposed to which venues an event links to.
 * A field left out stays as stored; null clears it.
 */
export const venueUpdateSchema = z.object({
  venue_id: z.string().trim().min(1).max(160),
  canonical_name: z.string().trim().min(1).max(240).optional(),
  administrative_area_id: z.string().trim().min(1).max(160).nullable().optional(),
  address_text: z.string().trim().max(500).nullable().transform((value) => value || null).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  coordinate_precision: coordinatePrecisionSchema.nullable().optional(),
  coordinate_source: z.string().trim().max(120).nullable().transform((value) => value || null).optional(),
  /** With a rename: also rewrite event links whose saved display name is the old venue name. */
  sync_display_names: z.boolean().optional(),
}).superRefine((update, context) => {
  const { venue_id: _id, sync_display_names: sync, ...fields } = update;
  if (!Object.keys(fields).length) {
    context.addIssue({ code: "custom", path: ["venue_id"], message: "至少需要修改一个场馆字段" });
  }
  if (sync && update.canonical_name === undefined) {
    context.addIssue({ code: "custom", path: ["sync_display_names"], message: "只有修改场馆名称时才能同步显示名" });
  }
  if ((update.latitude === undefined) !== (update.longitude === undefined) || (update.latitude === null) !== (update.longitude === null)) {
    context.addIssue({ code: "custom", path: ["latitude"], message: "纬度和经度必须同时填写或同时清空" });
  }
  if (update.latitude === null && (update.coordinate_precision || update.coordinate_source)) {
    context.addIssue({ code: "custom", path: ["coordinate_precision"], message: "清空坐标时不能填写坐标精度或来源" });
  }
});

const eventPatchFields = {
  slug: z.string().trim().min(3).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  title: z.string().trim().min(1).max(240).optional(),
  start_date: dateSchema.optional(),
  end_date: dateSchema.nullish(),
  start_time: timeSchema.nullish(),
  end_time: timeSchema.nullish(),
  timezone: z.string().trim().min(1).max(80).optional(),
  category: categorySchema.optional(),
  classification: z.string().trim().max(120).nullish(),
  location_mode: locationModeSchema.optional(),
  location_note: z.string().trim().max(1000).nullish(),
  venues: z.array(eventVenueInputSchema).max(20).optional(),
  channels: z.array(eventChannelInputSchema).max(20).optional(),
  remark: z.string().trim().max(4000).nullish(),
  sources: z.array(sourceInputSchema).max(10).optional()
};
const hasChange = (patch: object) => Object.keys(patch).length > 0;

/** Patch accepted from the official sync, which may not edit venue records. */
export const officialEventPatchSchema = z.object(eventPatchFields).refine(hasChange, "至少需要修改一个字段");

export const eventPatchSchema = z.object({
  ...eventPatchFields,
  venue_updates: z.array(venueUpdateSchema).min(1).max(20).optional()
    .describe("修改活动已关联场馆的记录本身：[{venue_id, canonical_name?, administrative_area_id?, address_text?, latitude?, longitude?, coordinate_precision?, coordinate_source?, sync_display_names?}]。只传要改的字段，null 表示清空；纬度和经度必须成对。活动页面显示的是各活动保存的当时显示名：纠正场馆名称的错字时传 sync_display_names=true，把显示名等于原名称的活动一并改为新名称；场馆真的更名时不要传，旧活动保留当时的名称。场馆由多个活动共用，修改对所有关联活动生效。不需要同时传 venues。"),
}).refine(hasChange, "至少需要修改一个字段").superRefine((patch, context) => {
  const ids = patch.venue_updates?.map((update) => update.venue_id) ?? [];
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["venue_updates"], message: "同一场馆只能出现一次" });
  }
});

export const searchInputSchema = z.object({
  source_url: sourceUrlSchema.optional(),
  query: z.string().trim().max(200).optional(),
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  categories: z.array(categorySchema).max(5).optional(),
  statuses: z.array(eventStatusSchema).max(4).optional(),
  published: z.boolean().optional(),
  include_archived: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(20),
  offset: z.number().int().min(0).default(0)
});

export const duplicateInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  start_date: dateSchema,
  end_date: dateSchema.nullish(),
  venue_id: z.string().trim().min(1).max(160).nullish(),
  source_url: sourceUrlSchema.optional(),
  category: categorySchema.optional(),
  location_mode: locationModeSchema.optional()
});

export const proposeCreateSchema = z.object({
  event: eventDraftSchema,
  source_url: sourceUrlSchema.optional(),
  reason: z.string().trim().min(1).max(1000),
  idempotency_key: z.string().trim().min(8).max(200)
});

export const proposeUpdateSchema = z.object({
  target_event_id: z.string().trim().min(1),
  expected_version: z.number().int().positive(),
  patch: eventPatchSchema,
  source_url: sourceUrlSchema,
  reason: z.string().trim().min(1).max(1000),
  idempotency_key: z.string().trim().min(8).max(200)
});

export const proposeStatusSchema = z.object({
  target_event_id: z.string().trim().min(1),
  expected_version: z.number().int().positive(),
  status: eventStatusSchema,
  source_url: sourceUrlSchema,
  reason: z.string().trim().min(1).max(1000),
  idempotency_key: z.string().trim().min(8).max(200)
});

const setlistProposalEntrySchema = z.object({
  song_id: z.string().trim().min(1).max(160),
  performed_version_id: z.string().trim().max(160).nullish().transform((value) => value || null),
  section: z.enum(["main", "encore", "double_encore", "opening", "other"]).default("main"),
  display_title: z.string().trim().max(240).nullish().transform((value) => value || null),
  medley_group: z.string().trim().max(40).nullish().transform((value) => value || null),
  notes: z.string().trim().max(1000).nullish().transform((value) => value || null),
});

export const proposeSetlistSchema = z.object({
  setlist_id: z.string().trim().min(1).max(160).optional()
    .describe("修改已有歌单时填写；新增歌单时不填"),
  expected_updated_at: z.string().trim().min(1).optional()
    .describe("修改时必填，取自 setlists.get 的 updated_at"),
  event_id: z.string().trim().min(1).max(160).optional()
    .describe("歌单所属活动；新增时必填，修改时省略表示不变"),
  setlist: z.object({
    performance_label: z.string().trim().min(1).max(160).default("本公演"),
    completeness: z.enum(["complete", "partial", "unknown"]),
    confidence: z.enum(["official", "reported", "unverified"]),
    notes: z.string().trim().max(4000).nullish().transform((value) => value || null),
    published: z.boolean().default(true),
    entries: z.array(setlistProposalEntrySchema).max(80)
      .describe("完整曲目，按演出顺序排列；修改时会整体替换原有曲目。song_id 和 performed_version_id 取自 songs.search"),
    sources: z.array(sourceInputSchema).max(10).default([]),
  }),
  source_url: sourceUrlSchema,
  reason: z.string().trim().min(1).max(1000),
  idempotency_key: z.string().trim().min(8).max(200)
}).superRefine((input, context) => {
  if (input.setlist_id && !input.expected_updated_at) {
    context.addIssue({ code: "custom", path: ["expected_updated_at"], message: "修改歌单时必须提供 expected_updated_at" });
  }
  if (!input.setlist_id && !input.event_id) {
    context.addIssue({ code: "custom", path: ["event_id"], message: "新增歌单时必须指定活动" });
  }
});

export const proposeLifecycleSchema = z.object({
  target_event_id: z.string().trim().min(1),
  expected_version: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000),
  idempotency_key: z.string().trim().min(8).max(200)
});

export type Category = z.infer<typeof categorySchema>;
export type EventStatus = z.infer<typeof eventStatusSchema>;
export type LocationMode = z.infer<typeof locationModeSchema>;
export type VenueRole = z.infer<typeof venueRoleSchema>;
export type ChannelType = z.infer<typeof channelTypeSchema>;
export type EventVenueInput = z.infer<typeof eventVenueInputSchema>;
export type EventChannelInput = z.infer<typeof eventChannelInputSchema>;
export type ChangeOperation = z.infer<typeof changeOperationSchema>;
export type ChangeStatus = z.infer<typeof changeStatusSchema>;
export type EventDraft = z.infer<typeof eventDraftSchema>;
export type EventPatch = z.infer<typeof eventPatchSchema>;
export type VenueUpdate = z.infer<typeof venueUpdateSchema>;
export type ProposeSetlistInput = z.infer<typeof proposeSetlistSchema>;
export type SourceInput = z.infer<typeof sourceInputSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
