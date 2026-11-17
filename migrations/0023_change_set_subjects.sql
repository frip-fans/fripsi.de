-- Proposals can now describe a setlist as well as an event. A setlist proposal keeps
-- target_event_id pointing at the show it belongs to, so it is listed and reviewed next to
-- that event's other proposals; subject_id is the setlist being edited, or NULL for a new one.
ALTER TABLE change_sets ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'event' CHECK (subject_type IN ('event', 'setlist'));
ALTER TABLE change_sets ADD COLUMN subject_id TEXT;
CREATE INDEX change_sets_subject ON change_sets (subject_type, subject_id) WHERE subject_id IS NOT NULL;
