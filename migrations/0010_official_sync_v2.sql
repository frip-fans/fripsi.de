-- Additive upgrade for official-source checkpoints, self-repair, reviews and bounded evaluations.
CREATE TABLE official_sync_sources (
  url TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  published_date TEXT,
  content_hash TEXT NOT NULL,
  paragraphs_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  processed_hash TEXT,
  processed_at TEXT
);
CREATE TABLE official_sync_run_sources (
  run_id TEXT NOT NULL REFERENCES official_sync_runs(id),
  url TEXT NOT NULL REFERENCES official_sync_sources(url),
  content_hash TEXT NOT NULL,
  PRIMARY KEY (run_id, url)
);
ALTER TABLE official_sync_runs ADD COLUMN tool_calls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE official_sync_runs ADD COLUMN policy_version TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE official_sync_runs ADD COLUMN stop_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE official_sync_runs ADD COLUMN review_session_id TEXT;
ALTER TABLE official_sync_runs ADD COLUMN review_input_json TEXT;
ALTER TABLE official_sync_runs ADD COLUMN review_report_json TEXT;
ALTER TABLE official_sync_runs ADD COLUMN review_attempted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE official_sync_runs ADD COLUMN primary_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE official_sync_runs ADD COLUMN budget_group TEXT;
CREATE TABLE official_sync_reviews (
  run_id TEXT NOT NULL REFERENCES official_sync_runs(id),
  change_id TEXT NOT NULL REFERENCES change_sets(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','resolved','unresolved','budget_stopped')),
  PRIMARY KEY (run_id, change_id)
);
CREATE TABLE official_sync_source_reviews (
  run_id TEXT NOT NULL REFERENCES official_sync_runs(id),
  source_url TEXT NOT NULL REFERENCES official_sync_sources(url),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','resolved','unresolved','budget_stopped')),
  PRIMARY KEY (run_id, source_url)
);
CREATE TABLE official_sync_budgets (
  id TEXT PRIMARY KEY,
  limit_usd REAL NOT NULL CHECK (limit_usd > 0),
  created_at TEXT NOT NULL
);
CREATE TABLE official_sync_usage (
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  budget_group TEXT NOT NULL REFERENCES official_sync_budgets(id),
  model TEXT NOT NULL,
  usage_json TEXT NOT NULL,
  estimated_usd REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, turn_id)
);
CREATE TABLE official_sync_reservations (
  id TEXT PRIMARY KEY,
  budget_group TEXT NOT NULL REFERENCES official_sync_budgets(id),
  model TEXT NOT NULL,
  reserved_usd REAL NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','closed'))
);
CREATE TABLE official_sync_evaluations (
  id TEXT PRIMARY KEY,
  budget_group TEXT NOT NULL REFERENCES official_sync_budgets(id),
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','starting','running','completed','failed','budget_stopped')),
  input_json TEXT NOT NULL,
  session_id TEXT,
  result_json TEXT,
  score_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
