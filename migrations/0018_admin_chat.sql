-- Admin chat assistant sessions. The reasoning loop and conversation history live on
-- OpenAI's side; this table only tracks which short-lived MCP credential is still valid.
CREATE TABLE admin_chat_sessions (
  -- Our own id is minted first: it is bound into the MCP credential before the
  -- remote session exists, because the credential is fixed in its tool configuration.
  id TEXT PRIMARY KEY,
  agent_session_id TEXT UNIQUE,
  actor_id TEXT NOT NULL,
  model TEXT NOT NULL,
  budget_group TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX admin_chat_sessions_actor ON admin_chat_sessions (actor_id, status, created_at);
