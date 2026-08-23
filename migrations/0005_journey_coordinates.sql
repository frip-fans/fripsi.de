PRAGMA foreign_keys = ON;

ALTER TABLE administrative_areas ADD COLUMN latitude REAL
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE administrative_areas ADD COLUMN longitude REAL
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE administrative_areas ADD COLUMN coordinate_source TEXT;
ALTER TABLE administrative_areas ADD COLUMN coordinates_verified_at TEXT;

CREATE INDEX idx_venues_coordinates ON venues (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX idx_administrative_areas_coordinates ON administrative_areas (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
