PRAGMA foreign_keys = ON;

ALTER TABLE events ADD COLUMN location_mode TEXT NOT NULL DEFAULT 'unknown'
  CHECK (location_mode IN ('none', 'physical', 'online', 'broadcast', 'hybrid', 'multiple', 'undisclosed', 'unknown'));
ALTER TABLE events ADD COLUMN location_note TEXT;

CREATE TABLE administrative_areas (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL CHECK (length(country_code) = 2),
  level TEXT NOT NULL CHECK (level IN ('country', 'subdivision', 'municipality', 'ward', 'locality')),
  parent_id TEXT,
  name_local TEXT NOT NULL,
  name_ja TEXT,
  name_zh TEXT,
  name_en TEXT,
  valid_from TEXT,
  valid_to TEXT,
  FOREIGN KEY (parent_id) REFERENCES administrative_areas(id) ON DELETE RESTRICT
);

CREATE INDEX idx_administrative_areas_parent ON administrative_areas (parent_id, name_local);
CREATE INDEX idx_administrative_areas_country ON administrative_areas (country_code, level, name_local);

CREATE TABLE administrative_area_codes (
  administrative_area_id TEXT NOT NULL,
  scheme TEXT NOT NULL,
  code TEXT NOT NULL,
  PRIMARY KEY (scheme, code),
  FOREIGN KEY (administrative_area_id) REFERENCES administrative_areas(id) ON DELETE CASCADE
);

CREATE INDEX idx_administrative_area_codes_area ON administrative_area_codes (administrative_area_id);

CREATE TABLE administrative_area_aliases (
  alias TEXT PRIMARY KEY,
  administrative_area_id TEXT NOT NULL,
  FOREIGN KEY (administrative_area_id) REFERENCES administrative_areas(id) ON DELETE CASCADE
);

CREATE TABLE venues (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  administrative_area_id TEXT,
  address_text TEXT,
  latitude REAL,
  longitude REAL,
  coordinate_precision TEXT CHECK (coordinate_precision IS NULL OR coordinate_precision IN ('entrance', 'building', 'site', 'approximate')),
  coordinate_source TEXT,
  coordinates_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'renamed', 'demolished', 'unknown')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (administrative_area_id) REFERENCES administrative_areas(id) ON DELETE RESTRICT,
  CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
);

CREATE INDEX idx_venues_area_name ON venues (administrative_area_id, canonical_name);
CREATE INDEX idx_venues_name ON venues (canonical_name);

CREATE TABLE venue_aliases (
  venue_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  PRIMARY KEY (venue_id, alias),
  FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
);

CREATE TABLE venue_external_ids (
  venue_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'osm', 'wikidata', 'official')),
  external_id TEXT NOT NULL,
  external_type TEXT,
  checked_at TEXT,
  PRIMARY KEY (venue_id, provider, external_id),
  FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
);

CREATE TABLE event_venues (
  event_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'secondary', 'broadcast_origin')),
  position INTEGER NOT NULL DEFAULT 1 CHECK (position > 0),
  display_name_snapshot TEXT,
  PRIMARY KEY (event_id, venue_id, role),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE RESTRICT
);

CREATE INDEX idx_event_venues_event_position ON event_venues (event_id, position);
CREATE INDEX idx_event_venues_venue ON event_venues (venue_id, event_id);

CREATE TABLE event_channels (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('streaming', 'radio', 'television', 'digital_store', 'download', 'other')),
  name TEXT NOT NULL,
  url TEXT,
  position INTEGER NOT NULL DEFAULT 1 CHECK (position > 0),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX idx_event_channels_event_position ON event_channels (event_id, position);

CREATE TABLE location_migration_backlog (
  event_id TEXT PRIMARY KEY,
  legacy_venue TEXT,
  legacy_region TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'ignored')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Countries currently represented by the archive.
INSERT INTO administrative_areas (id, country_code, level, parent_id, name_local, name_ja, name_zh, name_en) VALUES
  ('area_country_jp', 'JP', 'country', NULL, '日本', '日本', '日本', 'Japan'),
  ('area_country_sg', 'SG', 'country', NULL, 'Singapore', 'シンガポール', '新加坡', 'Singapore'),
  ('area_country_id', 'ID', 'country', NULL, 'Indonesia', 'インドネシア', '印度尼西亚', 'Indonesia'),
  ('area_country_tw', 'TW', 'country', NULL, '臺灣', '台湾', '台湾', 'Taiwan'),
  ('area_country_hk', 'HK', 'country', NULL, '香港', '香港', '香港', 'Hong Kong'),
  ('area_country_cn', 'CN', 'country', NULL, '中国', '中国', '中国', 'China'),
  ('area_country_th', 'TH', 'country', NULL, 'ประเทศไทย', 'タイ', '泰国', 'Thailand'),
  ('area_country_nl', 'NL', 'country', NULL, 'Nederland', 'オランダ', '荷兰', 'Netherlands'),
  ('area_country_kr', 'KR', 'country', NULL, '대한민국', '韓国', '韩国', 'South Korea');

INSERT INTO administrative_area_codes (administrative_area_id, scheme, code) VALUES
  ('area_country_jp', 'ISO_3166_1', 'JP'), ('area_country_sg', 'ISO_3166_1', 'SG'),
  ('area_country_id', 'ISO_3166_1', 'ID'), ('area_country_tw', 'ISO_3166_1', 'TW'),
  ('area_country_hk', 'ISO_3166_1', 'HK'), ('area_country_cn', 'ISO_3166_1', 'CN'),
  ('area_country_th', 'ISO_3166_1', 'TH'), ('area_country_nl', 'ISO_3166_1', 'NL'),
  ('area_country_kr', 'ISO_3166_1', 'KR');

-- All Japanese prefectures are available to the editor. JIS-compatible five-digit
-- standard area codes are the canonical municipality hierarchy identifiers.
INSERT INTO administrative_areas (id, country_code, level, parent_id, name_local, name_ja, name_zh, name_en) VALUES
  ('area_jp_01','JP','subdivision','area_country_jp','北海道','北海道','北海道','Hokkaido'),
  ('area_jp_02','JP','subdivision','area_country_jp','青森県','青森県','青森县','Aomori'),
  ('area_jp_03','JP','subdivision','area_country_jp','岩手県','岩手県','岩手县','Iwate'),
  ('area_jp_04','JP','subdivision','area_country_jp','宮城県','宮城県','宫城县','Miyagi'),
  ('area_jp_05','JP','subdivision','area_country_jp','秋田県','秋田県','秋田县','Akita'),
  ('area_jp_06','JP','subdivision','area_country_jp','山形県','山形県','山形县','Yamagata'),
  ('area_jp_07','JP','subdivision','area_country_jp','福島県','福島県','福岛县','Fukushima'),
  ('area_jp_08','JP','subdivision','area_country_jp','茨城県','茨城県','茨城县','Ibaraki'),
  ('area_jp_09','JP','subdivision','area_country_jp','栃木県','栃木県','栃木县','Tochigi'),
  ('area_jp_10','JP','subdivision','area_country_jp','群馬県','群馬県','群马县','Gunma'),
  ('area_jp_11','JP','subdivision','area_country_jp','埼玉県','埼玉県','埼玉县','Saitama'),
  ('area_jp_12','JP','subdivision','area_country_jp','千葉県','千葉県','千叶县','Chiba'),
  ('area_jp_13','JP','subdivision','area_country_jp','東京都','東京都','东京都','Tokyo'),
  ('area_jp_14','JP','subdivision','area_country_jp','神奈川県','神奈川県','神奈川县','Kanagawa'),
  ('area_jp_15','JP','subdivision','area_country_jp','新潟県','新潟県','新潟县','Niigata'),
  ('area_jp_16','JP','subdivision','area_country_jp','富山県','富山県','富山县','Toyama'),
  ('area_jp_17','JP','subdivision','area_country_jp','石川県','石川県','石川县','Ishikawa'),
  ('area_jp_18','JP','subdivision','area_country_jp','福井県','福井県','福井县','Fukui'),
  ('area_jp_19','JP','subdivision','area_country_jp','山梨県','山梨県','山梨县','Yamanashi'),
  ('area_jp_20','JP','subdivision','area_country_jp','長野県','長野県','长野县','Nagano'),
  ('area_jp_21','JP','subdivision','area_country_jp','岐阜県','岐阜県','岐阜县','Gifu'),
  ('area_jp_22','JP','subdivision','area_country_jp','静岡県','静岡県','静冈县','Shizuoka'),
  ('area_jp_23','JP','subdivision','area_country_jp','愛知県','愛知県','爱知县','Aichi'),
  ('area_jp_24','JP','subdivision','area_country_jp','三重県','三重県','三重县','Mie'),
  ('area_jp_25','JP','subdivision','area_country_jp','滋賀県','滋賀県','滋贺县','Shiga'),
  ('area_jp_26','JP','subdivision','area_country_jp','京都府','京都府','京都府','Kyoto'),
  ('area_jp_27','JP','subdivision','area_country_jp','大阪府','大阪府','大阪府','Osaka'),
  ('area_jp_28','JP','subdivision','area_country_jp','兵庫県','兵庫県','兵库县','Hyogo'),
  ('area_jp_29','JP','subdivision','area_country_jp','奈良県','奈良県','奈良县','Nara'),
  ('area_jp_30','JP','subdivision','area_country_jp','和歌山県','和歌山県','和歌山县','Wakayama'),
  ('area_jp_31','JP','subdivision','area_country_jp','鳥取県','鳥取県','鸟取县','Tottori'),
  ('area_jp_32','JP','subdivision','area_country_jp','島根県','島根県','岛根县','Shimane'),
  ('area_jp_33','JP','subdivision','area_country_jp','岡山県','岡山県','冈山县','Okayama'),
  ('area_jp_34','JP','subdivision','area_country_jp','広島県','広島県','广岛县','Hiroshima'),
  ('area_jp_35','JP','subdivision','area_country_jp','山口県','山口県','山口县','Yamaguchi'),
  ('area_jp_36','JP','subdivision','area_country_jp','徳島県','徳島県','德岛县','Tokushima'),
  ('area_jp_37','JP','subdivision','area_country_jp','香川県','香川県','香川县','Kagawa'),
  ('area_jp_38','JP','subdivision','area_country_jp','愛媛県','愛媛県','爱媛县','Ehime'),
  ('area_jp_39','JP','subdivision','area_country_jp','高知県','高知県','高知县','Kochi'),
  ('area_jp_40','JP','subdivision','area_country_jp','福岡県','福岡県','福冈县','Fukuoka'),
  ('area_jp_41','JP','subdivision','area_country_jp','佐賀県','佐賀県','佐贺县','Saga'),
  ('area_jp_42','JP','subdivision','area_country_jp','長崎県','長崎県','长崎县','Nagasaki'),
  ('area_jp_43','JP','subdivision','area_country_jp','熊本県','熊本県','熊本县','Kumamoto'),
  ('area_jp_44','JP','subdivision','area_country_jp','大分県','大分県','大分县','Oita'),
  ('area_jp_45','JP','subdivision','area_country_jp','宮崎県','宮崎県','宫崎县','Miyazaki'),
  ('area_jp_46','JP','subdivision','area_country_jp','鹿児島県','鹿児島県','鹿儿岛县','Kagoshima'),
  ('area_jp_47','JP','subdivision','area_country_jp','沖縄県','沖縄県','冲绳县','Okinawa'),
  ('area_jp_13104','JP','ward','area_jp_13','新宿区','新宿区','新宿区','Shinjuku'),
  ('area_jp_13115','JP','ward','area_jp_13','杉並区','杉並区','杉并区','Suginami');

INSERT INTO administrative_area_codes (administrative_area_id, scheme, code)
SELECT id, 'JP_STANDARD_AREA', substr(id, 9, 2) || '000'
FROM administrative_areas WHERE id GLOB 'area_jp_[0-4][0-9]';

INSERT INTO administrative_area_codes (administrative_area_id, scheme, code) VALUES
  ('area_jp_13104','JP_STANDARD_AREA','13104'),
  ('area_jp_13115','JP_STANDARD_AREA','13115');

-- Overseas cities/localities intentionally keep only their country code until a
-- trustworthy country-specific municipality code is assigned.
INSERT INTO administrative_areas (id, country_code, level, parent_id, name_local, name_ja, name_zh, name_en) VALUES
  ('area_sg','SG','locality','area_country_sg','Singapore','シンガポール','新加坡','Singapore'),
  ('area_id_jakarta','ID','municipality','area_country_id','Jakarta','ジャカルタ','雅加达','Jakarta'),
  ('area_tw_taipei','TW','municipality','area_country_tw','臺北市','台北市','台北市','Taipei'),
  ('area_hk','HK','locality','area_country_hk','香港','香港','香港','Hong Kong'),
  ('area_th_bangkok','TH','municipality','area_country_th','กรุงเทพมหานคร','バンコク','曼谷','Bangkok'),
  ('area_nl_hague','NL','municipality','area_country_nl','Den Haag','デン・ハーグ','海牙','The Hague'),
  ('area_kr_seoul','KR','municipality','area_country_kr','서울특별시','ソウル','首尔','Seoul'),
  ('area_cn_beijing','CN','municipality','area_country_cn','北京市','北京市','北京市','Beijing'),
  ('area_cn_shanghai','CN','municipality','area_country_cn','上海市','上海市','上海市','Shanghai'),
  ('area_cn_guangzhou','CN','municipality','area_country_cn','广州市','広州市','广州市','Guangzhou');

INSERT INTO administrative_area_aliases (alias, administrative_area_id) VALUES
  ('北海道','area_jp_01'),('青森','area_jp_02'),('岩手','area_jp_03'),('宮城','area_jp_04'),
  ('秋田','area_jp_05'),('山形','area_jp_06'),('福島','area_jp_07'),('茨城','area_jp_08'),
  ('栃木','area_jp_09'),('群馬','area_jp_10'),('埼玉','area_jp_11'),('千葉','area_jp_12'),
  ('千葉県','area_jp_12'),('東京','area_jp_13'),('東京都','area_jp_13'),('神奈川','area_jp_14'),
  ('新潟','area_jp_15'),('富山','area_jp_16'),('石川','area_jp_17'),('福井','area_jp_18'),
  ('山梨','area_jp_19'),('長野','area_jp_20'),('岐阜','area_jp_21'),('静岡','area_jp_22'),
  ('愛知','area_jp_23'),('愛知県','area_jp_23'),('愛知県名古屋市','area_jp_23'),
  ('三重','area_jp_24'),('滋賀','area_jp_25'),('京都','area_jp_26'),
  ('大阪','area_jp_27'),('大阪府','area_jp_27'),('大阪府大阪市','area_jp_27'),
  ('兵庫','area_jp_28'),('奈良','area_jp_29'),('和歌山','area_jp_30'),('鳥取','area_jp_31'),
  ('島根','area_jp_32'),('岡山','area_jp_33'),('広島','area_jp_34'),('山口','area_jp_35'),
  ('徳島','area_jp_36'),('香川','area_jp_37'),('愛媛','area_jp_38'),('高知','area_jp_39'),
  ('福岡','area_jp_40'),('佐賀','area_jp_41'),('長崎','area_jp_42'),('熊本','area_jp_43'),
  ('大分','area_jp_44'),('宮崎','area_jp_45'),('鹿児島','area_jp_46'),('沖縄','area_jp_47'),
  ('東京都新宿区','area_jp_13104'),('東京都杉並区','area_jp_13115'),
  ('Singapore','area_sg'),('Jakarta','area_id_jakarta'),('Taipei','area_tw_taipei'),('台湾','area_tw_taipei'),
  ('Hong Kong','area_hk'),('香港','area_hk'),('香港・旺角','area_hk'),
  ('Bangkok','area_th_bangkok'),('The Hague','area_nl_hague'),('首尔','area_kr_seoul'),
  ('北京','area_cn_beijing'),('上海','area_cn_shanghai'),('広州','area_cn_guangzhou');

UPDATE events SET location_mode = CASE
  WHEN (venue IS NULL OR trim(venue) = '') AND (region IS NULL OR trim(region) = '')
    THEN CASE WHEN category IN ('RELEASE', 'OTHER') THEN 'none' ELSE 'unknown' END
  WHEN region IN ('在线', 'オンライン') THEN 'online'
  WHEN region LIKE '%在线%' OR region LIKE '%オンライン%' THEN 'hybrid'
  WHEN region IN ('日本', '関東') THEN CASE WHEN category = 'MEDIA' THEN 'broadcast' ELSE 'unknown' END
  WHEN venue LIKE '%某处%' OR venue LIKE '%某所%' OR venue LIKE '%行程別%' THEN 'undisclosed'
  WHEN venue LIKE '%／%' AND region NOT LIKE '%／%' THEN 'multiple'
  ELSE 'physical'
END;

UPDATE events SET location_note = trim(COALESCE(region || ' · ', '') || COALESCE(venue, ''))
WHERE location_mode IN ('hybrid', 'multiple', 'undisclosed', 'unknown');

INSERT INTO venues (
  id, canonical_name, administrative_area_id, address_text, status, created_at, updated_at
)
SELECT
  'ven_mig_' || substr(replace(min(e.id), 'evt_', ''), 1, 32),
  trim(e.venue),
  COALESCE(a.administrative_area_id, CASE WHEN trim(e.venue) = 'Zepp Sapporo' THEN 'area_jp_01' END),
  NULL, 'unknown', min(e.created_at), max(e.updated_at)
FROM events e
LEFT JOIN administrative_area_aliases a ON a.alias = trim(e.region)
WHERE e.location_mode = 'physical' AND e.venue IS NOT NULL AND trim(e.venue) <> ''
GROUP BY trim(e.venue), COALESCE(a.administrative_area_id, CASE WHEN trim(e.venue) = 'Zepp Sapporo' THEN 'area_jp_01' END);

INSERT INTO venue_aliases (venue_id, alias)
SELECT id, canonical_name FROM venues;

INSERT INTO event_venues (event_id, venue_id, role, position, display_name_snapshot)
SELECT e.id, (
    SELECT v.id FROM venues v
    WHERE v.canonical_name = trim(e.venue)
      AND v.administrative_area_id IS COALESCE(a.administrative_area_id, CASE WHEN trim(e.venue) = 'Zepp Sapporo' THEN 'area_jp_01' END)
    ORDER BY v.id LIMIT 1
  ), 'primary', 1, trim(e.venue)
FROM events e
LEFT JOIN administrative_area_aliases a ON a.alias = trim(e.region)
WHERE e.location_mode = 'physical' AND e.venue IS NOT NULL AND trim(e.venue) <> '';

INSERT INTO event_channels (id, event_id, channel_type, name, position)
SELECT 'chn_mig_' || substr(replace(e.id, 'evt_', ''), 1, 32), e.id,
  CASE
    WHEN lower(COALESCE(e.venue, '')) LIKE '%radio%' OR e.venue LIKE '%ラジオ%' OR e.venue LIKE '%放送%' AND e.venue NOT LIKE '%テレビ%' THEN 'radio'
    WHEN lower(COALESCE(e.venue, '')) LIKE '%tv%' OR e.venue LIKE '%テレビ%' OR e.venue LIKE '%wowow%' THEN 'television'
    WHEN e.category = 'RELEASE' THEN 'digital_store'
    ELSE 'streaming'
  END,
  trim(COALESCE(e.venue, e.region)), 1
FROM events e
WHERE e.location_mode IN ('online', 'broadcast') AND trim(COALESCE(e.venue, e.region, '')) <> '';

INSERT INTO location_migration_backlog (event_id, legacy_venue, legacy_region, reason, created_at)
SELECT id, venue, region,
  CASE location_mode
    WHEN 'hybrid' THEN '线上与实体信息需要拆分'
    WHEN 'multiple' THEN '多个实体地点需要拆分'
    WHEN 'undisclosed' THEN '地点未公开或仅提供范围'
    ELSE '缺少可结构化的地点信息'
  END,
  updated_at
FROM events WHERE location_mode IN ('hybrid', 'multiple', 'undisclosed', 'unknown');

ALTER TABLE events DROP COLUMN venue;
ALTER TABLE events DROP COLUMN region;

CREATE INDEX idx_events_location_mode_date ON events (location_mode, start_date);
