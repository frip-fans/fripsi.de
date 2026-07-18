import { z } from "zod";

export const categorySchema = z.enum(["LIVE", "EVENT", "RELEASE", "MEDIA", "OTHER"]);
export const eventStatusSchema = z.enum(["scheduled", "completed", "cancelled", "postponed"]);
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
  venue: z.string().trim().max(240).nullish(),
  region: z.string().trim().max(120).nullish(),
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
  venue: z.string().trim().max(240).nullish(),
  region: z.string().trim().max(120).nullish(),
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
  limit: z.number().int().min(1).max(100).default(20)
});

export const duplicateInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  start_date: dateSchema,
  end_date: dateSchema.nullish(),
  venue: z.string().trim().max(240).nullish(),
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
export type ChangeOperation = z.infer<typeof changeOperationSchema>;
export type ChangeStatus = z.infer<typeof changeStatusSchema>;
export type EventDraft = z.infer<typeof eventDraftSchema>;
export type EventPatch = z.infer<typeof eventPatchSchema>;
export type SourceInput = z.infer<typeof sourceInputSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
