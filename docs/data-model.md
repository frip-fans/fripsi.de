# 数据模型

## 1. 设计目标

数据模型需要同时支持：

- 单日、跨日、全天和将来可能出现的定时活动。
- LIVE、EVENT、RELEASE、MEDIA、OTHER 分类及细分类。
- 取消、延期、完成、下线和归档。
- 多条官方来源。
- 人工编辑使用受控的直接保存链路，AI/MCP 使用可审核的提案发布链路。
- 幂等、防重复、乐观锁和完整审计。
- 从 Notion 一次性迁移约 369 条历史记录。
- 歌曲作品、录音/编曲版本、发行曲目与 Live 歌单之间的多向查询。

所有日期以 ISO 格式存储：

- 日期：`YYYY-MM-DD`
- 时间：`HH:mm`
- 时间戳：UTC RFC 3339，例如 `2026-07-18T12:30:00Z`
- 默认活动时区：`Asia/Tokyo`

## 2. 枚举

### `category`

```text
LIVE
EVENT
RELEASE
MEDIA
OTHER
```

### `event_status`

```text
scheduled
completed
cancelled
postponed
```

草稿不属于活动状态。`change_sets` 只保存 AI/MCP 或其他低信任自动化提交的待审核提案；可信人工维护者直接保存到正式表。`events.published = 0` 表示记录已保存在后台但尚未公开，不再另建一套人工草稿模型。

### `change_operation`

```text
create
update
status_change
unpublish
archive
restore
```

### `change_status`

```text
proposed
published
discarded
rejected
failed
```

## 3. 表结构

以下 SQL 是设计草案；实现时拆分为顺序编号的 D1 migration。

### 3.1 `events`

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  start_time TEXT,
  end_time TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  category TEXT NOT NULL CHECK (
    category IN ('LIVE', 'EVENT', 'RELEASE', 'MEDIA', 'OTHER')
  ),
  classification TEXT,
  location_mode TEXT NOT NULL CHECK (
    location_mode IN ('none', 'physical', 'online', 'broadcast', 'hybrid',
      'multiple', 'undisclosed', 'unknown')
  ),
  location_note TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (
    status IN ('scheduled', 'completed', 'cancelled', 'postponed')
  ),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  archived_at TEXT,
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (start_time IS NULL OR length(start_time) = 5),
  CHECK (end_time IS NULL OR length(end_time) = 5)
);

CREATE INDEX idx_events_public_date
  ON events (published, archived_at, start_date);

CREATE INDEX idx_events_category_date
  ON events (category, start_date);

CREATE INDEX idx_events_status_date
  ON events (status, start_date);
```

规则：

- `id` 使用应用生成的 UUID/ULID，不依赖标题。
- `slug` 是稳定公开 URL；修改标题不自动修改 slug。
- `end_date` 为空表示单日活动。
- 日期无具体时间时 `start_time`、`end_time` 均为空。
- `version` 每次成功更新加一，用于乐观锁。
- 归档不删除数据；`archived_at` 非空时不出现在公开站点。
- `location_mode` 表达地点形态；场馆、行政区和传播渠道不再保存为 `events` 自由文本列。
- `location_note` 只用于未公开、待确认或无法完全结构化的例外说明。

#### 3.1.1 结构化地点

`0004_structured_locations.sql` 增加以下实体：

```text
administrative_areas          国家、都道府县、市区町村等行政层级
administrative_area_codes     ISO 3166 与各国官方地区代码
administrative_area_aliases   旧地区文本到标准行政区的迁移映射
venues                        实体场馆、地址和经纬度
venue_aliases                 场馆历史名称和其他写法
venue_external_ids            Google、OSM、Wikidata 等外部引用
event_venues                  活动与一个或多个实体场馆的关联
event_channels                直播、广播、电视、数字商店等传播渠道
location_migration_backlog    无法安全自动拆分的旧地点待办
```

活动不会把 Google Place ID、OSM ID 或经纬度当成永久身份；`venues.id` 是站内稳定主键。日本行政区使用五位标准地域代码，国家使用 ISO 3166-1，一级行政区可同时登记 ISO 3166-2。

### 3.2 `event_sources`

```sql
CREATE TABLE event_sources (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  url TEXT NOT NULL,
  label TEXT,
  source_type TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT,
  UNIQUE (event_id, url)
);

CREATE INDEX idx_event_sources_event_id
  ON event_sources (event_id);
```

发布新活动或关键事实更新时至少需要一条来源 URL。历史数据允许在迁移阶段标记为 `legacy-import`，但新内容不允许无来源发布。

### 3.3 `change_sets`

```sql
CREATE TABLE change_sets (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK (
    operation IN (
      'create', 'update', 'status_change',
      'unpublish', 'archive', 'restore'
    )
  ),
  target_event_id TEXT,
  base_version INTEGER,
  payload_json TEXT NOT NULL,
  source_url TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (
    status IN ('proposed', 'published', 'discarded', 'rejected', 'failed')
  ),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_via TEXT NOT NULL CHECK (created_via IN ('admin', 'mcp', 'import')),
  created_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  published_at TEXT,
  error_message TEXT,
  FOREIGN KEY (target_event_id) REFERENCES events(id) ON DELETE RESTRICT
);

CREATE INDEX idx_change_sets_status_created
  ON change_sets (status, created_at);

CREATE INDEX idx_change_sets_target
  ON change_sets (target_event_id, created_at);
```

`payload_json` 必须先通过共享 Zod schema，再写入数据库。读取旧 change set 时仍需重新校验，不能假设历史 JSON 永远符合当前 schema。

### 3.4 `audit_logs`

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'ai', 'system')),
  channel TEXT NOT NULL CHECK (channel IN ('admin', 'mcp', 'import', 'system')),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  request_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_logs_target
  ON audit_logs (target_type, target_id, created_at);

CREATE INDEX idx_audit_logs_actor
  ON audit_logs (actor_id, created_at);
```

审计日志不保存 OAuth token、Cloudflare Access JWT、完整 AI 对话或其他凭据。

## 4. 发布事务

`changes.publish` 必须完成以下原子步骤：

1. 读取 change set，确认状态仍为 `proposed`。
2. 检查调用者具有所需 scope。
3. 对更新类操作检查 `events.version = base_version`。
4. 重新验证 `payload_json`。
5. 对 create/update 执行重复检测。
6. 写入或更新 `events`，版本号加一。
7. 原子替换 `event_venues`、`event_channels`，必要时创建新场馆。
8. 写入来源记录。
9. 更新 change set 为 `published`。
10. 写入包含 before/after 的 audit log。

如果版本不一致，返回冲突和当前记录，不自动覆盖。AI 或人工必须基于新版本重新生成 change set。

## 5. 重复检测

重复检查不能只依赖标题完全相同。候选规则包括：

- 日期区间重叠且标题标准化后相同。
- 同一天、同场地、相同分类，标题相似。
- 来源 URL 已存在。
- 同一巡演名称、同一城市、同一日期。

第一版输出候选及原因，由维护者或 AI 决定是否继续，不做自动合并。

## 6. Slug

公开 URL 示例：

```text
/events/2024-01-04-infinite-resonance-2-zepp-haneda
```

规则：

- 创建时生成并验证唯一性。
- 允许后台人工调整。
- 发布后修改 slug 必须创建显式 change set。
- 若修改已公开 slug，应保留旧 slug 重定向；可在后续增加 `event_redirects` 表。

## 7. Notion 旧数据迁移

Notion 当前数据库约有 369 条记录，字段包括：

```text
Tags, Date, Name, Remark, Classification, Text
```

迁移只执行一次：

1. 从 Notion 导出 CSV，保留原始文件为只读迁移证据。
2. 将 `Tags` 映射为 `category`。
3. 将 `Date` 拆分为开始日期和结束日期。
4. 将 `Name` 映射为 `title`。
5. 将 `Remark`、`Classification` 分别映射。
6. 从标题中识别取消、延期等标记，生成候选 `status`，再人工核验。
7. 排除仅用于旧 Gallery 展示的年度分隔记录，或将真实周年纪念归入 `OTHER`。
8. 保留原始 Notion page ID 到迁移报告中，便于回查；不作为运行时依赖。
9. 导入到 staging D1，生成统计和异常清单。
10. 人工确认后导入 production D1。

迁移验收至少包括：

- 原始记录数、导入数、排除数、失败数可对账。
- 日期最小值和最大值一致。
- 每个分类的数量可对账。
- 日期区间、同日多活动、取消/延期记录抽样检查。
- 不存在重复 slug、空标题或非法日期。

## 8. 导入导出

管理后台必须支持 UTF-8 CSV：

```text
id,slug,title,start_date,end_date,start_time,end_time,timezone,category,
classification,location_mode,location_note,venue_ids,venue_names,area_names,
area_codes,channels,remark,status,published,source_urls
```

导入分为两步：验证预览和明确确认。验证失败不能部分写入。导出包含所有活动和来源，但不包含 audit log 中的内部元数据。

## 9. 歌单库扩展

`0003_music_library.sql` 增加：

```text
songs                    作品主记录
song_aliases             搜索别名
song_versions            具体录音、编曲或演唱版本
song_version_relations   版本之间的有向关系
releases                 Album/Single/EP/Video 等发行物
release_tracks           Disc/Track 与歌曲版本的关联
setlists                 与 events 关联的一份 Live 歌单
setlist_entries          顺序、章节、作品及可选的具体版本
catalog_sources          歌曲、版本、发行物和歌单的来源
```

完整语义、CSV 字段和导入流程见 [歌单库](./music-library.md)。
