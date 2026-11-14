-- Operator-editable settings that must survive a deploy and be shared by both app
-- instances. One row per setting key; the value is JSON so a setting can grow fields
-- without another migration.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
