-- Retain votes from local previews that used the earlier 1–5 scale.
CREATE TABLE IF NOT EXISTS song_version_votes (
  version_id TEXT NOT NULL REFERENCES song_versions(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (version_id, voter_id)
);

CREATE TABLE song_version_votes_expanded (
  version_id TEXT NOT NULL REFERENCES song_versions(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (version_id, voter_id)
);

INSERT INTO song_version_votes_expanded (version_id, voter_id, score, updated_at)
SELECT version_id, voter_id, score, updated_at FROM song_version_votes;

DROP TABLE song_version_votes;
ALTER TABLE song_version_votes_expanded RENAME TO song_version_votes;
