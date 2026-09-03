import type { Category, ChangeOperation, ChangeStatus, ChannelType, EventChannelInput, EventStatus, EventVenueInput, LocationMode, SourceInput, VenueRole } from "./schema";

export interface EventLocationInput {
  location_mode: LocationMode;
  location_note: string | null;
  venues: EventVenueInput[];
  channels: EventChannelInput[];
}

export interface AdministrativeArea {
  id: string;
  country_code: string;
  level: "country" | "subdivision" | "municipality" | "ward" | "locality";
  parent_id: string | null;
  name_local: string;
  name_ja: string | null;
  name_zh: string | null;
  name_en: string | null;
  codes: Array<{ scheme: string; code: string }>;
}

export interface VenueRecord {
  id: string;
  canonical_name: string;
  administrative_area_id: string | null;
  address_text: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinate_precision: "entrance" | "building" | "site" | "approximate" | null;
  coordinate_source: string | null;
  coordinates_verified_at: string | null;
  status: "active" | "closed" | "renamed" | "demolished" | "unknown";
  created_at: string;
  updated_at: string;
  area_name: string | null;
  country_code: string | null;
}

export interface EventVenue extends VenueRecord {
  role: VenueRole;
  position: number;
  display_name_snapshot: string | null;
}

export interface EventChannel {
  id: string;
  event_id: string;
  channel_type: ChannelType;
  name: string;
  url: string | null;
  position: number;
}

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
  location_mode: LocationMode;
  location_note: string | null;
  venues: EventVenue[];
  channels: EventChannel[];
  venue_label: string | null;
  area_label: string | null;
  location_label: string | null;
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

export interface ArchiveFilterEntry {
  id: string;
  title: string;
  start_date: string;
  category: Category;
  classification: string | null;
  location_note: string | null;
  remark: string | null;
  venue_names: string[];
  area_ids: string[];
  area_names: string[];
  channel_names: string[];
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
  after: Partial<EventRecord> & { location_input?: EventLocationInput };
  duplicate_candidates: DuplicateCandidate[];
  warnings: string[];
  public_path: string | null;
}
