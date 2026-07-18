import type { Category, ChangeOperation, ChangeStatus, EventStatus, SourceInput } from "./schema";

export interface EventRecord {
  id: string;
  slug: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  timezone: string;
  category: Category;
  classification: string | null;
  venue: string | null;
  region: string | null;
  remark: string | null;
  status: EventStatus;
  published: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  archived_at: string | null;
  sources?: EventSource[];
}

export interface EventSource extends SourceInput {
  id: string;
  event_id: string;
  verified_at: string | null;
  created_at: string;
  created_by: string;
}

export interface ChangeSet {
  id: string;
  operation: ChangeOperation;
  target_event_id: string | null;
  base_version: number | null;
  payload_json: string;
  source_url: string | null;
  reason: string | null;
  status: ChangeStatus;
  idempotency_key: string;
  created_by: string;
  created_via: "admin" | "mcp" | "import";
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  published_at: string | null;
  error_message: string | null;
}

export interface AuditLog {
  id: string;
  actor_id: string;
  actor_type: "human" | "ai" | "system";
  channel: "admin" | "mcp" | "import" | "system";
  action: string;
  target_type: string;
  target_id: string | null;
  request_id: string;
  before_json: string | null;
  after_json: string | null;
  metadata_json: string | null;
  created_at: string;
}

export interface Actor {
  id: string;
  type: "human" | "ai" | "system";
  channel: "admin" | "mcp" | "import" | "system";
  scopes: string[];
}

export interface DuplicateCandidate {
  event: EventRecord;
  reasons: string[];
}

export interface ChangePreview {
  change: ChangeSet;
  before: EventRecord | null;
  after: Partial<EventRecord>;
  duplicate_candidates: DuplicateCandidate[];
  warnings: string[];
  public_path: string | null;
}
