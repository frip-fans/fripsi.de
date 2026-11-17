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
  /** Admin-set display name; see event-display.ts. */
  alias?: string | null;
  tour_id?: string | null;
  /** Stop label within the tour, e.g. 東京公演; derived from the venue area when empty. */
  tour_stop?: string | null;
  /** Published tour the event belongs to, filled by hydrateEventLocations. */
  tour?: { id: string; slug: string; name: string } | null;
  /** Alias > tour · stop > title, filled by hydrateEventLocations. */
  display_title?: string;
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
  chat_session_id?: string | null;
  /** What the proposal edits; absent on rows read before the column existed, which are all events. */
  subject_type?: "event" | "setlist";
  /** The setlist a setlist proposal edits; null for a new setlist and for event proposals. */
  subject_id?: string | null;
}

export interface SetlistChangeEntry {
  position: number;
  section: "main" | "encore" | "double_encore" | "opening" | "other";
  song_id: string;
  song_title: string;
  performed_version_id: string | null;
  performed_version_title: string | null;
  display_title: string;
  medley_group: string | null;
  notes: string | null;
}

export interface SetlistSnapshot {
  performance_label: string;
  completeness: "complete" | "partial" | "unknown";
  confidence: "official" | "reported" | "unverified";
  notes: string | null;
  published: boolean;
  entries: SetlistChangeEntry[];
  sources: string[];
}

/** A setlist proposal as it would apply now: the stored setlist, if any, and what would replace it. */
export interface SetlistChangePreview {
  setlist_id: string | null;
  before: SetlistSnapshot | null;
  after: SetlistSnapshot;
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
  automation_run_id?: string;
  /** Set for the admin chat assistant, so its proposals are attributable to one session. */
  chat_session_id?: string;
  automation_role?: "primary" | "review";
  id: string;
  type: "human" | "ai" | "system";
  channel: "admin" | "mcp" | "import" | "system";
  scopes: string[];
}

export interface DuplicateCandidate {
  event: EventRecord;
  reasons: string[];
}

export type VenueField = "canonical_name" | "administrative_area_id" | "address_text" | "latitude" | "longitude" | "coordinate_precision" | "coordinate_source";

export interface VenueFieldChange {
  field: VenueField;
  before: string | number | null;
  after: string | number | null;
  /** Readable form of an id value, e.g. the name of an administrative area. */
  before_label?: string | null;
  after_label?: string | null;
}

/** Edits to one venue record carried by an update proposal, against the values stored now. */
export interface VenueChange {
  venue_id: string;
  /** The name stored now, before any rename in this proposal. */
  canonical_name: string;
  /** Only the fields whose value would actually change. */
  fields: VenueFieldChange[];
  /** Other events linked to the same venue; the edit applies to them too. */
  other_event_count: number;
  /** On a rename: event links that keep showing their own display name instead of the new one. */
  kept_display_names?: number;
  /** On a rename with sync_display_names: event links whose display name follows the rename. */
  synced_display_names?: number;
}

export interface ChangePreview {
  change: ChangeSet;
  before: EventRecord | null;
  after: Partial<EventRecord> & { location_input?: EventLocationInput };
  /** Present only on a setlist proposal; `before` and `after` then both hold the show it belongs to. */
  setlist?: SetlistChangePreview;
  /** Present only when the proposal edits venue records. */
  venue_changes?: VenueChange[];
  duplicate_candidates: DuplicateCandidate[];
  warnings: string[];
  public_path: string | null;
}

/** Public card projection; full records remain available to detail and editing flows. */
export type EventSummary = Pick<EventRecord,
  "id" | "slug" | "title" | "start_date" | "end_date" | "start_time" | "end_time" | "timezone"
  | "category" | "classification" | "location_mode" | "location_note" | "status"
  | "venues" | "channels" | "venue_label" | "area_label" | "location_label" | "display_title" | "tour">;
