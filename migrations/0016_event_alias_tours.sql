-- Display names and tours for events.
-- An event shows, in order of preference: its alias, "<tour name> · <stop>", then its official title.
-- The stop is tour_stop, or "<area>公演" derived from the event's first venue area.
CREATE TABLE tours (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  notes TEXT,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE events ADD COLUMN alias TEXT;
ALTER TABLE events ADD COLUMN tour_id TEXT REFERENCES tours(id);
ALTER TABLE events ADD COLUMN tour_stop TEXT;

CREATE INDEX idx_events_tour ON events (tour_id, start_date);
