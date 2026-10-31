-- Notification delivery is independent from publishing and contains no device credentials.
CREATE TABLE official_sync_notification_state (
  channel TEXT PRIMARY KEY CHECK (channel = 'bark'),
  activated_at TEXT NOT NULL
);

CREATE TABLE official_sync_notifications (
  run_id TEXT PRIMARY KEY REFERENCES official_sync_runs(id),
  payload_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','sending','sent','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  claim_id TEXT,
  last_error_code TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX official_sync_notifications_due
  ON official_sync_notifications(status, available_at, locked_until);
