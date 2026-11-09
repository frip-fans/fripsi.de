-- Streaming platform identifiers for releases and individual release tracks.
-- Apple Music ids belong to a storefront (fripSide's catalog is in "jp");
-- YouTube ids are video ids (e.g. "fripSide - Topic" art tracks).
CREATE TABLE release_external_ids (
  release_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('apple_music', 'youtube')),
  external_id TEXT NOT NULL,
  storefront TEXT,
  checked_at TEXT,
  PRIMARY KEY (release_id, provider),
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
);

CREATE TABLE release_track_external_ids (
  release_track_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('apple_music', 'youtube')),
  external_id TEXT NOT NULL,
  storefront TEXT,
  checked_at TEXT,
  PRIMARY KEY (release_track_id, provider),
  FOREIGN KEY (release_track_id) REFERENCES release_tracks(id) ON DELETE CASCADE
);
