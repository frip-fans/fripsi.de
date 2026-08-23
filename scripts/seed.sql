INSERT OR IGNORE INTO events (
  id, slug, title, start_date, end_date, start_time, end_time, timezone,
  category, classification, location_mode, location_note, remark, status, published,
  version, created_at, updated_at, published_at
) VALUES
  ('evt_demo_tokyo', '2026-08-31-fripside-fan-calendar-demo', 'fripSide Event Calendar Demo', '2026-08-31', NULL, '18:00', NULL, 'Asia/Tokyo', 'EVENT', 'Demo', 'physical', NULL, '本记录仅用于本地开发，请在导入正式数据前移除。', 'scheduled', 1, 1, '2026-07-18T12:00:00Z', '2026-07-18T12:00:00Z', '2026-07-18T12:00:00Z'),
  ('evt_demo_release', '2026-07-20-fripside-release-demo', 'Release Archive Demo', '2026-07-20', NULL, NULL, NULL, 'Asia/Tokyo', 'RELEASE', 'Demo', 'none', NULL, '本记录仅用于本地开发。', 'completed', 1, 1, '2026-07-18T12:00:00Z', '2026-07-18T12:00:00Z', '2026-07-18T12:00:00Z');

INSERT OR IGNORE INTO venues (
  id, canonical_name, administrative_area_id, status, created_at, updated_at
) VALUES ('ven_demo_tokyo', 'Tokyo Garden Theater', 'area_jp_13', 'active', '2026-07-18T12:00:00Z', '2026-07-18T12:00:00Z');

INSERT OR IGNORE INTO venue_aliases (venue_id, alias) VALUES ('ven_demo_tokyo', 'Tokyo Garden Theater');
INSERT OR IGNORE INTO event_venues (event_id, venue_id, role, position, display_name_snapshot)
VALUES ('evt_demo_tokyo', 'ven_demo_tokyo', 'primary', 1, 'Tokyo Garden Theater');

INSERT OR IGNORE INTO event_sources (
  id, event_id, url, label, source_type, verified_at, created_at, created_by
) VALUES
  ('src_demo_tokyo', 'evt_demo_tokyo', 'https://fripside.net/', 'fripSide official', 'official', '2026-07-18T12:00:00Z', '2026-07-18T12:00:00Z', 'seed'),
  ('src_demo_release', 'evt_demo_release', 'https://fripside.net/', 'fripSide official', 'official', '2026-07-18T12:00:00Z', '2026-07-18T12:00:00Z', 'seed');
