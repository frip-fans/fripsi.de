PRAGMA foreign_keys = ON;

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  start_time TEXT,
  end_time TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  category TEXT NOT NULL CHECK (category IN ('LIVE', 'EVENT', 'RELEASE', 'MEDIA', 'OTHER')),
  classification TEXT,
  venue TEXT,
  region TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'postponed')),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  archived_at TEXT,
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (start_time IS NULL OR length(start_time) = 5),
  CHECK (end_time IS NULL OR length(end_time) = 5)
);

CREATE INDEX idx_events_public_date ON events (published, archived_at, start_date);
CREATE INDEX idx_events_category_date ON events (category, start_date);
CREATE INDEX idx_events_status_date ON events (status, start_date);

CREATE TABLE event_sources (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  url TEXT NOT NULL,
  label TEXT,
  source_type TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT,
  UNIQUE (event_id, url)
);

CREATE INDEX idx_event_sources_event_id ON event_sources (event_id);
CREATE INDEX idx_event_sources_url ON event_sources (url);

CREATE TABLE change_sets (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'status_change', 'unpublish', 'archive', 'restore')),
  target_event_id TEXT,
  base_version INTEGER,
  payload_json TEXT NOT NULL,
  source_url TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'published', 'discarded', 'rejected', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_via TEXT NOT NULL CHECK (created_via IN ('admin', 'mcp', 'import')),
  created_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  published_at TEXT,
  error_message TEXT,
  FOREIGN KEY (target_event_id) REFERENCES events(id) ON DELETE RESTRICT
);

CREATE INDEX idx_change_sets_status_created ON change_sets (status, created_at);
CREATE INDEX idx_change_sets_target ON change_sets (target_event_id, created_at);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'ai', 'system')),
  channel TEXT NOT NULL CHECK (channel IN ('admin', 'mcp', 'import', 'system')),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  request_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_logs_target ON audit_logs (target_type, target_id, created_at);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_id, created_at);

CREATE TABLE operation_receipts (
  idempotency_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
