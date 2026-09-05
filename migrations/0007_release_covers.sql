-- Apply before deploying code that selects these nullable columns.
ALTER TABLE releases ADD COLUMN cover_url TEXT;
ALTER TABLE releases ADD COLUMN cover_source_url TEXT;
