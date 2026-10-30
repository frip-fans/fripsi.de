import { eventDraftSchema, eventPatchSchema, eventStatusSchema } from "./schema";
import { z } from "zod";

const evidence = {
  source_url: z.url(),
  evidence_quote: z.string().max(8000).default(""),
  source_revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  evidence_refs: z.array(z.string().regex(/^p\d+-[a-f0-9]{12}$/)).max(12).default([]),
  reason: z.string().min(1).max(1000),
  needs_review: z.boolean(),
};
export const actionSchema = z.discriminatedUnion("operation", [
  z.object({ ...evidence, operation: z.literal("create"), event: eventDraftSchema }),
  z.object({ ...evidence, operation: z.literal("update"), target_event_id: z.string().min(1), expected_version: z.number().int().positive(), patch: eventPatchSchema }),
  z.object({ ...evidence, operation: z.literal("status_change"), target_event_id: z.string().min(1), expected_version: z.number().int().positive(), status: eventStatusSchema }),
]);
export type SyncAction = z.infer<typeof actionSchema>;
