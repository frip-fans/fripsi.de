-- Additive: compatible with existing web and MCP deployments.
CREATE TABLE official_sync_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'applying', 'completed', 'failed')),
  session_id TEXT,
  input_json TEXT,
  result_json TEXT,
  summary_json TEXT,
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX official_sync_one_active ON official_sync_runs ((1))
  WHERE status IN ('starting', 'running', 'applying');
CREATE TABLE official_sync_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
