-- Images a maintainer attached to a chat message: a JSON array of {id,type,bytes}.
-- The files themselves live in the private chat media directory, one folder per
-- session, and are never part of the database or its backups.
ALTER TABLE admin_chat_messages ADD COLUMN attachments_json TEXT;
