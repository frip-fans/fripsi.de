-- Search aliases for releases (Chinese/English titles, nicknames), mirroring song_aliases.
-- Public and admin release search match these in addition to title, catalogue number and edition.
CREATE TABLE release_aliases (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
  UNIQUE (release_id, normalized_alias)
);

CREATE INDEX idx_release_aliases_release ON release_aliases (release_id);
