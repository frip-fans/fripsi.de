import { z } from "zod";

export const categorySchema = z.enum(["LIVE", "EVENT", "RELEASE", "MEDIA", "OTHER"]);
export const eventStatusSchema = z.enum(["scheduled", "completed", "cancelled", "postponed"]);
export const locationModeSchema = z.enum(["none", "physical", "online", "broadcast", "hybrid", "multiple", "undisclosed", "unknown"]);
export const venueRoleSchema = z.enum(["primary", "secondary", "broadcast_origin"]);
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
  coordinate_precision: z.enum(["entrance", "building", "site", "approximate"]).nullish(),
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

export const eventPatchSchema = z.object({
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
}).refine((patch) => Object.keys(patch).length > 0, "至少需要修改一个字段");

export const searchInputSchema = z.object({
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
  source_url: sourceUrlSchema.optional()
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
export type SourceInput = z.infer<typeof sourceInputSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
