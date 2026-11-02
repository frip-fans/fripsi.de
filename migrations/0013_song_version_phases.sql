-- A version may feature more than one lineup. Populate only from verified credits.
CREATE TABLE IF NOT EXISTS song_version_phases (
  version_id TEXT NOT NULL REFERENCES song_versions(id) ON DELETE CASCADE,
  phase INTEGER NOT NULL CHECK (phase IN (1, 2, 3)),
  PRIMARY KEY (version_id, phase)
);
