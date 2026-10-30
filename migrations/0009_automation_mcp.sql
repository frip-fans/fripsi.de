-- Explicit daily authorization and proposal ownership for the remote agent loop.
ALTER TABLE official_sync_runs ADD COLUMN auto_publish INTEGER NOT NULL DEFAULT 0 CHECK (auto_publish IN (0, 1));
CREATE TABLE official_sync_changes (
  run_id TEXT NOT NULL REFERENCES official_sync_runs(id),
  change_id TEXT NOT NULL REFERENCES change_sets(id),
  action_json TEXT NOT NULL,
  preview_digest TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, change_id)
);
