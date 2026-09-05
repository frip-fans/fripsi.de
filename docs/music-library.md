# 歌单库

状态：第一、第二阶段已实现，待导入真实数据并执行生产迁移  
最后更新：2026-07-19

## 1. 能解决什么问题

歌单库把三类事实连接在一起：

- **作品（Song）**：例如 `only my railgun`。同一首作品只建立一次。
- **版本（Song Version）**：原版、`version 2007`、`crossroads version`、翻唱、Remix 等具体录音或编曲。
- **出现位置**：一方面是 Album/Single 等发行物的曲目位置，另一方面是某场 Live 的演唱顺序。

公开站支持以下查询：

1. 某场 Live 唱了哪些歌。
2. 某张发行物的每首歌曾在哪些 Live 演唱。
3. 某首歌有哪些版本、收录在哪些发行物、历次在哪些 Live 出现。
4. 一个版本由哪个版本重新录制、重新编曲、翻唱或 Remix 而来。

入口为 `/music/lives`，子页面为：

```text
/music/lives               Live 歌单列表和搜索
/music/lives/:id           某场 Live 的歌单
/music/releases            发行物列表和筛选
/music/releases/:slug      曲目与演唱统计
/music/songs               歌曲搜索
/music/songs/:slug         版本、发行物和 Live 历史
```

活动详情页也会在存在公开歌单时显示歌单入口。

## 2. 数据边界

### 作品与版本

`songs` 是作品层，负责稳定歌名、别名和原始演唱者。`song_versions` 是具体版本层。不要因为标题带有 `version 2007` 就创建另一首作品；应创建新的 version 并通过 `song_version_relations` 指向基础版本。

允许的版本关系：

```text
re-recording_of
rearrangement_of
remix_of
cover_of
live_version_of
instrumental_of
edit_of
other
```

关系方向为 `child_version_id -> parent_version_id`。例如 crossroads version 是原版的重新编曲版本：

```text
crossroads version --rearrangement_of--> original version
```

### 发行物

`releases` 保存 Album、Single、EP、Compilation、Video 或 Other；`release_tracks` 保存 Disc 与 Track 位置，并指向具体 song version。

### Live 歌单

`setlists` 必须关联现有 `events` 行，不重复保存演出日期、地点和标题。一个活动可通过不同 `performance_label` 保存上半场、下半场或昼夜公演。

`setlist_entries.song_id` 必填，表示可以确定演唱了哪首作品；`performed_version_id` 可空，因为大量历史歌单只写歌名，不能据此断定现场采用了哪个编曲。前端因此区分：

- “歌曲演唱场次”：按 song 统计，信息较完整。
- “明确为此版本”：只有来源能确认具体 version 时才计数，属于保守统计。

`completeness` 表示歌单是否完整，`confidence` 区分官方来源、现场记录和待核实资料。

## 3. CSV 导入

模板位于：

- `data/templates/music-release-tracks.csv`
- `data/templates/music-setlists.csv`

先复制模板到 `data/raw/` 并填写。歌曲别名可在 `song_aliases` 中使用 `|` 或 `;` 分隔。Slug 只允许小写字母、数字与连字符。对于不在本批发行物中的旧版歌曲，可填写 `parent_version_slug`、`parent_version_title` 与关系类型；导入器会创建不占用发行曲目位置的父版本记录。

生成校验报告和幂等 SQL：

```bash
npm run import:music -- \
  data/raw/music-release-tracks.csv \
  data/raw/music-setlists.csv
```

默认输出：

```text
data/normalized/music-library-import.sql
data/reports/music-library-import.json
```

校验发现空标题、非法日期、重复 Track/Position、版本关系缺失或枚举错误时，不生成 SQL。SQL 使用稳定 ID 与 `ON CONFLICT`，相同输入可重复执行。

本地验证：

```bash
npm run db:migrate:local
npx wrangler d1 execute frip-fan-dev \
  --local \
  --config apps/web/wrangler.jsonc \
  --file data/normalized/music-library-import.sql
```

如果 `event_slug` 不存在，导入会利用非空外键使整个事务失败，而不是静默丢弃该歌单。

### 后台人工编辑

有 `music:write` 权限的维护者可以在 `/admin/music` 直接维护：

- `/admin/music/setlists`：关联活动、演出标签、完整度、可信度、来源、公开状态和完整演唱顺序；支持上下移动、Medley 分组和逐项选择歌曲版本。
- `/admin/music/releases`：专辑元数据、来源、公开状态，以及 Disc/Track、歌曲版本和显示标题。
- `/admin/music/songs`：新增或编辑歌曲本体、别名、首次发行日期、来源与一个或多个歌曲版本；保存后会立即进入 Setlist 和专辑编辑器的选择列表。

保存会直接写入 D1，并同时写 operation receipt 和 audit log；关闭“公开显示”可以先保存在后台。CSV/SQL 仍适合大批量、可复现导入，后台表单适合日常少量修正。

## 4. 上生产的顺序

Web 的活动详情和 sitemap 会查询新表，因此必须先迁移数据库，再部署代码：

1. 保存生产 D1 的恢复点或导出备份。
2. 执行 `0003_music_library.sql` 的 production migration。
3. 导入并核对第一批歌单/发行物 SQL。
4. 部署 Web Worker。
5. 检查 `/music`、一个 Live、一个发行物、一个歌曲详情和 `/sitemap.xml`。

在真实 CSV 与页面抽样确认前，不执行第 2–4 步。

### 第三期专辑数据集

官方 Discography 自 2022-10-19 起的第三期 Album 已整理为可复现数据集：

```bash
npm run build:phase3-albums
npm run import:music -- \
  data/normalized/fripside-phase3-album-tracks.csv \
  data/normalized/fripside-phase3-empty-setlists.csv \
  data/normalized/fripside-phase3-albums.sql
```

数据集包含 `double Decades`、`infinite Resonance` 1–4，以及《とある科学の超音楽集》。合装版 `double Decades＋infinite Resonance` 不重复建档；合集附带 Blu-ray 和门店特典 Remix 也不进入标准 Album 曲目。范围、官方来源和排除理由记录在 `data/reports/fripside-phase3-albums-summary.json`。

### Liberation Protocol 首批 Live 歌单

大阪（2025-11-03）与东京（2026-01-04）两场歌单可重复生成并导入：

```bash
npm run build:liberation-setlists
npm run import:music -- \
  data/templates/music-release-tracks.csv \
  data/normalized/fripside-liberation-protocol-livefans-setlists.csv \
  data/normalized/fripside-liberation-protocol-setlists.sql
```

东京场的四组串烧不会合并为虚构歌曲：每首组成曲仍是独立的 `setlist_entries`，连续条目通过 `medley_group` 组成 Medley。这样歌曲页可以正常统计每首歌的 Live 演唱记录，歌单页也能保留串烧结构。曲序和 Medley 边界来自 LiveFans 用户投稿，故 `confidence` 使用 `reported`；来源范围和核对方法记录在 `data/reports/fripside-liberation-protocol-setlists-summary.json`。

### Animelo Summer Live 2025–2026

两年 Animelo Summer Live 的 fripSide 出演段落可重复生成并导入：

```bash
npm run build:anisama-setlists
npm run import:music -- \
  data/templates/music-release-tracks.csv \
  data/normalized/fripside-anisama-2025-2026-setlists.csv \
  data/normalized/fripside-anisama-2025-2026-setlists.sql
```

2025 年官方歌单中的黑崎真音／ALTIMA Medley 保存为七首独立组成曲，逐曲合作人员写入 entry notes；这不会创建虚构的录音版本。两场均复用 `events.classification = 拼盘`，Live 歌单列表可据此与单独公演分开筛选。来源与交叉核对记录在 `data/reports/fripside-anisama-2025-2026-setlists-summary.json`。

### 亚洲拼盘出演歌单

横滨、台北、大阪、东京新宿与香港五场拼盘活动的 fripSide 出演段落可重复生成并导入：

```bash
npm run build:asia-festival-setlists
npm run import:music -- \
  data/templates/music-release-tracks.csv \
  data/normalized/fripside-asia-festival-setlists.csv \
  data/normalized/fripside-asia-festival-setlists.sql
```

台北与 ANIMAX MUSIX 两场使用官方报告，`confidence = official`；横滨、リスアニ！ナイト和香港来自用户提供的现场歌单，并用官方活动资料或公开社区整理交叉核对，`confidence = reported`。リスアニ！ナイト的五首串烧曲目以独立记录共享同一 `medley_group`。五场均复用已有的拼盘活动记录；来源与版本关联规则记录在 `data/reports/fripside-asia-festival-setlists-summary.json`。

### the Dawn of Resonance 全国巡演 FINAL

2025-02-16 丰洲 PIT 的 47 都道府县全国巡演 FINAL 完整歌单可重复生成并导入：

```bash
npm run build:dawn-final-setlist
npm run import:music -- \
  data/templates/music-release-tracks.csv \
  data/normalized/fripside-dawn-of-resonance-final-setlist.csv \
  data/normalized/fripside-dawn-of-resonance-final-setlist.sql
```

本篇 21 首与 Encore 2 首使用不同的 `section` 保存；`Salvation` 与 `with a smile` 的现场主唱写入 entry notes。歌单来自リスアニ！官方公演报告，`confidence = official`。范围与保守版本关联规则记录在 `data/reports/fripside-dawn-of-resonance-final-setlist-summary.json`。

## 5. 数据质量规则

- Live 日期、地点、状态只来自 `events`，歌单不能覆盖这些事实。
- 一个发行位置 `(release, disc, track)` 只能有一条记录。
- 一个歌单位置 `(setlist, position)` 只能有一条记录。
- 同一活动可有多份歌单，但 `performance_label` 必须不同。
- 版本关系不能指向自己。
- 不确定具体现场版本时留空，不根据歌名猜测。
- 来源保存到 `catalog_sources`；公开页面显示来源，但不把来源可信度与歌单完整度混为一谈。

## 6. 后续阶段

当前采用仓库内 CSV + 审核后 SQL 的维护方式。后续可在不改变公开查询模型的前提下增加：

- 管理后台的批量导入预览与版本合并；歌曲和歌曲版本的日常新增、编辑已经由后台表单支持。
- MCP 的只读歌曲查询与受控提案工具。
- 巡演维度统计、演唱频率排行和按时期/成员过滤。
- 对 Medley、MC、SE 与伴奏曲更精细的结构化表达。

## 专辑封面

发行物支持官网封面地址、来源页面和后台预览。历史封面采集、版本匹配及独立内容导入见 [专辑封面维护](release-covers.md)。
