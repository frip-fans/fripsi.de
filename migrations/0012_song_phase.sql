-- fripSide eras a song belongs to, as a bit mask for the public ranking filter:
-- 1 = Phase 1, 2 = Phase 2, 4 = Phase 3. Joint songs set several bits
-- (e.g. 3 = sung by Phase 1 and Phase 2 together, 7 = all three).
-- NULL means the song is not a fripSide main-line song (covers, guest work) or is not classified yet;
-- such songs appear only in the unfiltered ranking.
ALTER TABLE songs ADD COLUMN phase_mask INTEGER CHECK (phase_mask IS NULL OR phase_mask BETWEEN 1 AND 7);
