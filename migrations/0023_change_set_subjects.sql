-- Proposals can now describe other records than an event: a setlist, a song, a release or a tour.
-- subject_id is the record being edited, or NULL until a proposal that creates one is published.
-- A setlist proposal keeps target_event_id pointing at the show it belongs to, so it is listed and
-- reviewed next to that event's other proposals. The set of subject types is checked in code, so a
-- new one needs no table rebuild.
ALTER TABLE change_sets ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'event';
ALTER TABLE change_sets ADD COLUMN subject_id TEXT;
CREATE INDEX change_sets_subject ON change_sets (subject_type, subject_id) WHERE subject_id IS NOT NULL;
