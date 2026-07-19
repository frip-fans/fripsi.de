PRAGMA foreign_keys = ON;

CREATE TABLE songs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  original_artist TEXT NOT NULL DEFAULT 'fripSide',
  first_release_date TEXT,
  notes TEXT,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (first_release_date IS NULL OR length(first_release_date) = 10)
);

CREATE INDEX idx_songs_public_title ON songs (published, normalized_title);

CREATE TABLE song_aliases (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
  UNIQUE (song_id, normalized_alias)
);

CREATE INDEX idx_song_aliases_normalized ON song_aliases (normalized_alias);

CREATE TABLE song_versions (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  version_label TEXT,
  artist_credit TEXT NOT NULL DEFAULT 'fripSide',
  release_date TEXT,
  notes TEXT,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE RESTRICT,
  CHECK (release_date IS NULL OR length(release_date) = 10)
);

CREATE INDEX idx_song_versions_song ON song_versions (song_id, release_date, title);

CREATE TABLE song_version_relations (
  id TEXT PRIMARY KEY,
  child_version_id TEXT NOT NULL,
  parent_version_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN (
    're-recording_of', 'rearrangement_of', 'remix_of', 'cover_of',
    'live_version_of', 'instrumental_of', 'edit_of', 'other'
  )),
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (child_version_id) REFERENCES song_versions(id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_version_id) REFERENCES song_versions(id) ON DELETE RESTRICT,
  UNIQUE (child_version_id, parent_version_id, relation_type),
  CHECK (child_version_id <> parent_version_id)
);

CREATE INDEX idx_song_version_relations_parent ON song_version_relations (parent_version_id);

CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  release_type TEXT NOT NULL CHECK (release_type IN ('album', 'single', 'ep', 'compilation', 'video', 'other')),
  release_date TEXT,
  catalog_number TEXT,
  edition TEXT,
  notes TEXT,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (release_date IS NULL OR length(release_date) = 10)
);

CREATE INDEX idx_releases_public_date ON releases (published, release_date, title);

CREATE TABLE release_tracks (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  song_version_id TEXT NOT NULL,
  disc_number INTEGER NOT NULL DEFAULT 1 CHECK (disc_number >= 1),
  track_number INTEGER NOT NULL CHECK (track_number >= 1),
  display_title TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE RESTRICT,
  FOREIGN KEY (song_version_id) REFERENCES song_versions(id) ON DELETE RESTRICT,
  UNIQUE (release_id, disc_number, track_number)
);

CREATE INDEX idx_release_tracks_version ON release_tracks (song_version_id, release_id);

CREATE TABLE setlists (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  performance_label TEXT NOT NULL DEFAULT '本公演',
  title TEXT,
  completeness TEXT NOT NULL DEFAULT 'unknown' CHECK (completeness IN ('complete', 'partial', 'unknown')),
  confidence TEXT NOT NULL DEFAULT 'unverified' CHECK (confidence IN ('official', 'reported', 'unverified')),
  notes TEXT,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT,
  UNIQUE (event_id, performance_label)
);

CREATE INDEX idx_setlists_public_event ON setlists (published, event_id);

CREATE TABLE setlist_entries (
  id TEXT PRIMARY KEY,
  setlist_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
  section TEXT NOT NULL DEFAULT 'main' CHECK (section IN ('main', 'encore', 'double_encore', 'opening', 'other')),
  song_id TEXT NOT NULL,
  performed_version_id TEXT,
  display_title TEXT NOT NULL,
  medley_group TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (setlist_id) REFERENCES setlists(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE RESTRICT,
  FOREIGN KEY (performed_version_id) REFERENCES song_versions(id) ON DELETE RESTRICT,
  UNIQUE (setlist_id, position)
);

CREATE INDEX idx_setlist_entries_song ON setlist_entries (song_id, setlist_id);
CREATE INDEX idx_setlist_entries_version ON setlist_entries (performed_version_id, setlist_id);

CREATE TABLE catalog_sources (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('song', 'version', 'release', 'setlist')),
  subject_id TEXT NOT NULL,
  url TEXT NOT NULL,
  label TEXT,
  source_type TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (subject_type, subject_id, url)
);

CREATE INDEX idx_catalog_sources_subject ON catalog_sources (subject_type, subject_id);
CREATE INDEX idx_catalog_sources_url ON catalog_sources (url);
