-- Chat transcripts move into the local database. The assistant must be able to show an
-- earlier conversation, and an expired session's MCP credential is gone, so replaying the
-- transcript from the provider is not available once a session ends.
ALTER TABLE admin_chat_sessions ADD COLUMN title TEXT;
ALTER TABLE admin_chat_sessions ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;

-- Proposals belong to the session that produced them. Attributing them by creation time
-- misfiles every proposal once two sessions overlap.
ALTER TABLE change_sets ADD COLUMN chat_session_id TEXT;

CREATE TABLE admin_chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES admin_chat_sessions(id),
  -- Assistant rows carry the Agents API turn they came from; a user row is written
  -- before any turn exists, so this stays null for those.
  turn_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'error')),
  body TEXT NOT NULL,
  -- JSON array of {name,status} as read from SessionProgress.tools.mcp_calls.
  tool_calls_json TEXT,
  created_at TEXT NOT NULL
);
-- Reads order by (created_at, rowid); rowid cannot appear in an index, and the
-- leading two columns already narrow a session's rows to a short scan.
CREATE INDEX admin_chat_messages_session ON admin_chat_messages (session_id, created_at);
-- Reading a turn is at-least-once: the same completed turn must not append a second reply.
CREATE UNIQUE INDEX admin_chat_messages_turn ON admin_chat_messages (session_id, turn_id, role)
  WHERE turn_id IS NOT NULL;
CREATE INDEX change_sets_chat_session ON change_sets (chat_session_id)
  WHERE chat_session_id IS NOT NULL;
