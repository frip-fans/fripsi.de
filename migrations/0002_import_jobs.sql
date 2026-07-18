CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('validated', 'imported', 'failed')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  report_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  imported_at TEXT
);

CREATE INDEX idx_import_jobs_created ON import_jobs (created_at);
