-- When a song has exactly one non-instrumental version, a missing performed
-- version is unambiguous. Keep multi-version songs unset unless a source names
-- the performed version explicitly.
UPDATE setlist_entries AS entry
SET performed_version_id = (
  SELECT MIN(version.id)
  FROM song_versions AS version
  WHERE version.song_id = entry.song_id
    AND lower(COALESCE(version.version_label, '')) NOT LIKE '%instrumental%'
)
WHERE entry.performed_version_id IS NULL
  AND (
    SELECT COUNT(*)
    FROM song_versions AS version
    WHERE version.song_id = entry.song_id
      AND lower(COALESCE(version.version_label, '')) NOT LIKE '%instrumental%'
  ) = 1;
