-- Visitor comments, stored with the rest of the site instead of in GitHub Discussions.
-- A thread is the site-wide board or one event; an event's setlist pages show the
-- event's thread, so one show has one conversation.
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_type TEXT NOT NULL CHECK (thread_type IN ('site', 'event')),
  thread_id TEXT NOT NULL,
  -- Replies are one level deep: a reply to a reply is filed under the same top-level comment.
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL CHECK (length(author_name) BETWEEN 1 AND 24),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  locale TEXT,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  -- Keyed hash of the sender's network address. It limits repeat posting and lets a
  -- moderator block a source; the address itself is never stored.
  source_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  moderated_at TEXT,
  moderated_by TEXT
);

CREATE INDEX comments_thread ON comments (thread_type, thread_id, status, id);
CREATE INDEX comments_parent ON comments (parent_id);
CREATE INDEX comments_source ON comments (source_hash, created_at);
CREATE INDEX comments_created ON comments (created_at);

CREATE TABLE comment_blocks (
  source_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

-- The last comment the maintainer was told about; delivery itself lives in the sync job.
CREATE TABLE comment_notification_state (
  channel TEXT PRIMARY KEY CHECK (channel = 'bark'),
  last_comment_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
