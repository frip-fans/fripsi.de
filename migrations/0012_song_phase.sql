-- Song era for the public ranking filter: 1 = Phase 1, 2 = Phase 2, 3 = Phase 3.
-- NULL means the song is not a fripSide main-line song (covers, guest work) or is not classified yet;
-- such songs appear only in the unfiltered ranking.
ALTER TABLE songs ADD COLUMN phase INTEGER CHECK (phase IS NULL OR phase IN (1, 2, 3));
