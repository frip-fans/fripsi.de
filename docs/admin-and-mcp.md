# 管理后台与 MCP

> 生产 Web：`https://fripsi.de`，MCP：`https://fripsi.de/mcp`；测试 Web：`https://staging.fripsi.de`，测试 MCP：`https://mcp-staging.fripsi.de/mcp`。部署见 [部署与运维](oci-deployment.md)。

## 1. 共同业务层

管理后台和 MCP 是两种操作界面，但必须调用同一套服务：

```text
Admin API ──> ContentAdminService ─────────────> SQLite
MCP Tools ──> EventService / ChangeService ───> SQLite
```

共享服务负责：

- 输入 schema 和字段规范化。
- 权限判断。
- 重复检测。
- 来源要求。
- 幂等和乐观锁。
- 人工直接保存或 change set 发布的条件写入。
- audit log。

不能只在前端或 MCP 工具描述中声明规则；服务端必须再次执行。

## 2. 管理后台

### 2.1 身份

`/admin/*` 和 `/api/admin/*` 使用 Cloudflare Access 保护。允许登录方式可从邮件一次性验证码开始，后续接入 GitHub/Google。

应用接到请求后仍需验证 `Cf-Access-Jwt-Assertion`：

- 签名有效。
- issuer 匹配 Access team domain。
- audience 匹配本应用 AUD。
- token 未过期。
- email/identity 满足应用角色要求。

### 2.2 角色

第一版定义两个逻辑角色：

| 角色 | 权限 |
|---|---|
| editor | 查询、检查 AI 提案、导入验证 |
| publisher | editor 的全部权限，加人工直接保存、公开/隐藏、归档和正式导入 |

身份来源和角色映射可以先通过 Access policy/配置完成，不急于创建站内用户密码表。

### 2.3 页面与行为

活动表格支持：

- 标题、日期、结构化场馆、行政区、渠道和来源搜索。
- 分类、状态、年份、发布状态过滤。
- 默认按日期倒序，近期活动可单独切换正序。
- 显示来源、最后修改人、版本号和待处理 change set。

编辑表单支持：

- 单日或日期区间。
- 全天或具体时间。
- 分类和细分类。
- 状态、地点形态、一个或多个实体场馆、行政区、线上/广播渠道和备注。
- 多个来源 URL。
- 别名（显示名）、所属巡演和场次，规则见 [数据模型](./data-model.md#显示名与巡演0016_event_alias_tourssql)。
- 直接保存；关闭“公开显示”后记录只在后台可见。

`/admin/tours` 维护巡演的名称、slug、说明和是否公开，并列出各站、歌单是否已补；同一巡演中显示名重复的站会被标出，需要在活动里填写场次。巡演详情页可以搜索活动并批量加入（已属其他巡演的会移过来），也可以直接移出某一站；每场变化都会提升活动版本并写入审计日志（`content.event.tour`）。移出或移到其他巡演时会清空该活动的场次。

`/admin/venues` 列出场馆及其行政区、坐标和使用它的活动数，可按名称、别名、地址或行政区搜索。场馆页编辑名称、行政区、地址和坐标，与 MCP 的 `patch.venue_updates` 是同一组字段和同一套写入规则：改名时原名称保留为别名；勾选“改名时同步显示名”会把当时显示名等于原名称的活动一并改为新名称，不勾则旧活动保留当时的名称。场馆记录由活动共用，保存后所有关联活动都会读到新内容，但活动版本号不变；审计动作为 `content.venue.update`。新场馆仍在活动编辑页创建，活动编辑页的每个既有场馆都有到场馆页的链接。

人工后台不为每次编辑额外创建 change set。所有保存仍要求服务端校验、幂等键和乐观锁，并在同一 batch（SQLite 事务）中写入业务数据、operation receipt 和 audit log。`change_sets` 保留给 AI/MCP 提案，避免低风险日常维护被重复确认拖慢，也不降低自动化写入的审核门槛。

危险操作必须二次确认，并显示影响：

- 下线：公开站点将不可见。
- 取消/延期：仍公开显示，但状态改变。
- 归档：从公开站点和默认后台列表移除，可恢复。

不提供硬删除按钮。

## 3. Remote MCP

### 3.1 定位

MCP 让 Codex、ChatGPT 或其他兼容客户端成为受控编辑助手。MCP 模式本身不需要站点调用 OpenAI API，也不提供面向公开访客的聊天框；后台维护者的聊天入口是另一条受控通道，见[后台聊天编辑助手](./admin-chat.md)。另有独立的[官方活动自动同步任务](./official-sync.md)，在维护者启用自动发布后，通过共享业务层验证并发布；不改变 MCP 对每次发布明确确认的要求。

典型对话：

```text
用户：这是官方公告链接，请把 8 月 31 日的活动加进去。
AI：我找到一个同日同场地的相似活动。以下是拟新增内容和差异，是否发布？
用户：是，发布。
AI：已发布，并返回公开活动 URL。
```

### 3.2 Transport 与认证

MCP 处理（`apps/mcp`，由 Web 进程在 `/mcp` 调用）使用 `@modelcontextprotocol/server` v2 和 `agents/mcp/server` 的无状态 `createMcpHandler`。认证通过后传入 server factory，每个请求创建独立服务器，并绑定本次认证身份；不复用已连接的服务器或权限上下文。

`@modelcontextprotocol/server` 与测试客户端 `@modelcontextprotocol/client` 的版本按 Agents 的 peer 要求精确匹配。项目不再依赖 SDK v1。handler 使用 `responseMode: "json"`，并以 `legacy: "stateless"` 兼容现有 2025-era HTTP 客户端；这不需要保留 SDK v1 或协议会话。

普通编辑者的发布确认、自动同步身份的任务绑定与 `preview_digest` 校验继续由现有业务服务执行。协议测试覆盖自动同步的查询、提案、预览和自动发布；HTTP 测试覆盖 v2 客户端、旧客户端初始化、未认证拒绝和 Host/Origin 校验。

MCP 随网站一起部署：staging 验收后通过发布 PR 进入生产，没有单独的 MCP 部署流程。

- Endpoint：`https://fripsi.de/mcp`（测试：`https://mcp-staging.fripsi.de/mcp`）
- Transport：Streamable HTTP
- Authentication：OAuth 2.1
- OAuth provider：优先 Cloudflare Access OAuth Provider
- 匿名调用：不允许

每日官方同步使用专用的短期任务 JWT，不通过普通 OAuth scope 获得自动发布权限。它由同步任务签发，由 MCP 处理独立校验，详见[自动同步的认证与配置](./official-sync.md)。

建议 scopes：

```text
events:read
events:draft
events:publish
events:archive
```

MCP 端点必须发布 protected resource metadata，验证 token 的签名、issuer、audience/resource、有效期和 scopes。

### 3.3 工具清单

#### `events.search`

用途：按关键词、日期、分类和状态查询活动。

```text
scope: events:read
readOnlyHint: true
destructiveHint: false
openWorldHint: false
```

主要输入：

```json
{
  "query": "string?",
  "date_from": "YYYY-MM-DD?",
  "date_to": "YYYY-MM-DD?",
  "categories": ["LIVE"],
  "statuses": ["scheduled"],
  "limit": 20
}
```

#### `events.get`

用途：读取单个活动、来源、版本和未完成 change set。

```text
scope: events:read
readOnlyHint: true
```

#### `events.list_upcoming`

用途：读取下一场和近期活动，用于检查日历现状。

```text
scope: events:read
readOnlyHint: true
```

#### `events.check_duplicate`

用途：在提出新增前检查日期、标题、场地和来源重复。

```text
scope: events:read
readOnlyHint: true
```

#### `areas.search`

用途：按名称或地域代码查找行政区，取得新建场馆和 `venue_updates` 需要的 `administrative_area_id`。自动同步身份不挂载。

```text
scope: events:read
readOnlyHint: true
```

#### `changes.propose_create`

用途：提出新增活动，但不直接公开。

```text
scope: events:draft
readOnlyHint: false
destructiveHint: false
openWorldHint: false
```

要求：

- `idempotency_key`
- 结构化活动数据
- `source_url`
- 创建原因/摘要

#### `changes.propose_update`

用途：基于当前版本提出字段修改。

要求：

- `target_event_id`
- `expected_version`
- 只传要修改的字段
- `idempotency_key`
- 来源和原因

场馆记录本身（名称、行政区、地址、坐标）通过 `patch.venue_updates` 修改，不需要同时传 `venues`：

```json
{ "venue_updates": [{ "venue_id": "ven_…", "address_text": "東京都江東区有明2-1-6", "latitude": 35.6367, "longitude": 139.7915 }] }
```

| 字段 | 说明 |
|---|---|
| `canonical_name` | 场馆名称，不能为空。新名称同时写入 `venue_aliases`，原名称保留为别名 |
| `administrative_area_id` | 行政区 ID，用 `areas.search` 查找，必须已存在；`null` 清空 |
| `address_text` | 地址；`null` 清空 |
| `latitude` / `longitude` | 必须成对填写或成对清空。变化时更新 `coordinates_verified_at`；清空时一并清空精度和来源 |
| `coordinate_precision` / `coordinate_source` | 只在场馆有坐标时可填 |
| `sync_display_names` | 只能与 `canonical_name` 一起传。`true` 时把当时显示名等于原名称的活动关联一并改为新名称 |

- 只传要修改的字段，未传的字段保持不变。
- `venue_id` 取自 `events.get` 返回的 `venues[].id`，且必须是该活动（应用本次 patch 之后）关联的场馆。未关联的场馆、不存在的行政区等无法发布的修改返回 `invalid_venue_update`。
- 场馆记录由多个活动共用：发布后所有关联活动都会读到新内容，但只有目标活动的版本号递增。`changes.preview` 在 `venue_changes` 中逐字段给出修改前后的值和受影响的其他活动数量，并写入警告。
- 页面显示场馆时优先使用活动关联上保存的当时显示名（`display_name_snapshot`），因此改名默认不会改变已保存显示名的活动——场馆真的更名时，旧活动应继续显示当时的名称。纠正错字时传 `sync_display_names: true`：显示名等于原名称的关联跟随改名，另行填写过显示名的关联保持不变。预览在 `venue_changes` 中给出跟随（`synced_display_names`）和保留（`kept_display_names`）的数量并写入警告；个别活动可通过 `venues[].display_name_snapshot` 单独修改。
- 场馆修改随活动更新在同一个 batch 内写入，受同一乐观锁保护；审计记录的 metadata 带有 `venue_changes`。
- 活动的显示别名和巡演归属用 `patch.alias`、`patch.tour_id`（取自 `tours.search`，`null` 表示移出巡演）和 `patch.tour_stop`；`changes.propose_create` 用同名字段的 `display` 对象。巡演不存在时返回 `invalid_tour`。官方活动自动同步不接受这三个字段。
- 场馆状态（`status`）和外部 ID 暂不支持。官方活动自动同步（`sync.propose`）不接受 `venue_updates`。

#### `songs.search`、`setlists.search`、`setlists.get`

用途：歌单提案需要的只读查询，自动同步身份不挂载。

- `songs.search`：按标题或别名查歌曲，返回 `song_id`、别名和各版本的 `version_id`。
- `setlists.search`：按关键词查歌单，或用 `event_id` 列出一场活动的全部歌单。
- `setlists.get`：一份歌单的完整曲目、来源、`updated_at` 和未完成的提案。

```text
scope: events:read
readOnlyHint: true
```

包含未公开的歌曲和歌单，与 `events.search` 对非自动同步身份的行为一致。

#### `changes.propose_setlist`

用途：为一场活动新增歌单，或整体替换已有歌单；只创建待审核提案。

```text
scope: events:draft
readOnlyHint: false
destructiveHint: false
```

- 新增：传 `event_id`。同一活动同一场次（`performance_label`，默认“本公演”）已有歌单时拒绝，返回 `invalid_setlist` 并给出已有歌单的 ID。
- 修改：传 `setlist_id` 和 `setlists.get` 返回的 `updated_at`（`expected_updated_at`）。歌单在此之后被改过则返回 `version_conflict`。
- `setlist.entries` 是按演出顺序排列的**完整**曲目，修改时整体替换。每首必须有 `song_id`；`performed_version_id` 可选，且必须属于该歌曲。不存在的歌曲或版本在提案时就被拒绝（`invalid_song` / `invalid_version`）——缺的歌曲先用 `changes.propose_song` 提案并发布。
- 来源只增不减：发布时保留歌单已有的来源，再加上提案的 `sources` 和 `source_url`。
- 必须带 HTTPS 的 `source_url` 和原因。

提案记录在 `change_sets` 中，`subject_type` 为 `setlist`，`target_event_id` 指向所属活动，因此会出现在该活动的待处理提案里。`changes.preview` 在 `setlist` 字段返回修改前后的完整曲目和属性，`before` / `after` 则是所属活动；歌单已过期或场次冲突时写入警告。发布走同一个 `changes.publish`，需要 `events:publish` 和 `music:write`，实际写入由后台保存歌单的同一段代码完成；发布结果返回 `setlist_id`。提案等待期间歌单被改过的，发布以 `version_conflict` 失败，需要重新提案，不提供“按当前版本发布”。

#### 歌曲、专辑、巡演、场馆的查询

用途：只读查询，自动同步身份不挂载，包含未公开的记录。

- `songs.get`：一首歌曲的全部字段、别名、版本、来源和 `updated_at`。
- `releases.search`、`releases.get`：专辑和单曲；`releases.get` 返回曲目表，含 `song_version_id`、Apple Music 曲目 ID 和 YouTube 视频 ID。
- `tours.search`、`tours.get`：巡演及其场次。
- `venues.search`、`venues.get`：场馆、别名和关联活动。
- `apple_music.search`：在 Apple Music 日区查专辑；传 `album_id` 返回曲目和曲目 ID。

`songs.get`、`releases.get`、`tours.get` 同时返回该记录未完成的提案。

#### `changes.propose_song`、`changes.propose_release`、`changes.propose_tour`

用途：新增或修改歌曲、专辑、巡演；只创建待审核提案。与后台对应的编辑页写入同一批字段。

行为：

- 新增：不传 ID，内容对象（`song` / `release` / `tour`）给出完整内容。新建歌曲时省略 `versions` 会自动建一个与歌曲同名的版本。
- 修改：传 `song_id` / `release_id` / `tour_id` 和对应 get 工具返回的 `updated_at`（`expected_updated_at`），内容对象里**只写要改的字段**，其余保持不变。记录在读取之后被改过则返回 `version_conflict`；内容与当前相同返回 `no_change`。
- 列表字段（`aliases`、`sources`、专辑的 `tracks`）给出时整体替换。歌曲的 `versions` 例外：只列要改或要加的版本，带 `id` 的是修改，不带的是新增，未列出的保持不变；已有版本不能删除。
- 只改曲目的试听链接时用 `release.track_links`，按碟号和曲序定位，不必重发曲目表：

  ```json
  { "track_links": [{ "track_number": 3, "youtube_video_id": "https://www.youtube.com/watch?v=…" }] }
  ```

  `youtube_video_id` 接受视频链接或 11 位 ID，保存为 ID；`null` 表示清空。位置不存在时返回 `invalid_track`。
- 专辑曲目引用的歌曲版本必须已存在。封面只能填已导入本站图片库的路径，MCP 不能导入封面图片。
- `source_url` 可选，给出时一并记入来源。
- 提案时就执行后台保存的全部校验（slug 冲突、版本归属等），不通过则直接拒绝（`invalid_song` / `invalid_release` / `invalid_tour`）。

提案的 `subject_type` 为 `song` / `release` / `tour`，`target_event_id` 为空。`changes.preview` 在 `catalog` 字段返回修改前后的完整记录（`before`、`after` 与保存时的结构相同），`before` / `after` 字段为空。发布走 `changes.publish`，歌曲和专辑需要 `events:publish` 和 `music:write`，实际写入由后台保存的同一段代码完成；发布结果返回 `song_id` / `release_id` / `tour_id`。过期的提案以 `version_conflict` 失败，需要重新提案。

#### `comments.list`、`comments.moderate`、`comments.set_blocked_terms`、`audit.list`

用途：留言审核和审计日志，只对有 `events:publish` 的身份挂载。

与后台留言页一样**立即生效，不经过提案**：`comments.moderate` 的 `action` 为 `hide`、`restore`、`delete`、`block`（封禁该留言的来源）或 `unblock`（按 `source` 解除封禁）；`comments.set_blocked_terms` 整体替换屏蔽词。两者都要求 `confirm=true`，并写入审计日志。`audit.list` 按时间倒序列出写操作记录。

#### `changes.propose_status`

用途：提出取消、延期或恢复为 scheduled/completed。

状态变化不得通过修改标题中的文本代替。

#### `changes.preview`

用途：返回规范化后的活动预览、before/after diff、重复候选、警告和公开 URL 预估。

```text
scope: events:read
readOnlyHint: true
```

#### `changes.publish`

用途：应用已经预览的 change set。

```text
scope: events:publish
readOnlyHint: false
destructiveHint: false
openWorldHint: true
```

这是公开发布动作。工具描述必须明确要求用户确认；服务端还要检查 change set 未变化且 `base_version` 仍有效。

#### `changes.discard`

用途：丢弃尚未发布的 change set。

```text
scope: events:draft
readOnlyHint: false
destructiveHint: true
openWorldHint: false
```

#### `changes.propose_unpublish` / `changes.propose_archive`

用途：提出下线或归档，仍需 `changes.publish` 才生效。

```text
scope: events:archive
readOnlyHint: false
destructiveHint: true
openWorldHint: true
```

### 3.4 不提供的工具

- `execute_sql`
- `delete_event`
- `fetch_any_url`
- `run_javascript`
- `bulk_publish`
- 绕过 change set 的 `update_event`
- 返回 OAuth token、Access JWT、数据库内部配置的资源或工具

网页查证由 AI Client 完成。自动发布另由 MCP 对固定官方域名做受限来源核对；不提供任意 URL 抓取工具。

### 3.5 已授权的自动发布

维护者启用每日自动同步后，专用身份可使用 `sync.propose` → `changes.preview` → `changes.publish_automatic`，无需逐条确认。发布工具要求本次服务端预览摘要，只接受当前活跃任务关联的活动新增、修改或状态变更；来源、重复、版本和审计检查仍然执行。普通 MCP 身份不暴露这些自动化写入工具，也不能仅凭 OAuth scope 升级为自动身份。

### 3.6 歌单搜集任务的工具

每日的歌单搜集任务使用另一种自动化身份，只挂载下列工具，不挂载活动工具，也不挂载 3.3 中的 `songs.search`、`changes.propose_setlist` 等普通工具。规则与范围见 [官方活动自动同步](official-sync.md#歌单搜集任务)。

- `sync.find_songs`：按歌名查音乐库，返回是否已有（`exists`）、命中的歌曲及其版本、相近的歌曲。
- `sync.create_song`：新建音乐库没有的歌曲；歌名、别名与已有歌曲重复时返回 `duplicate_song` 和已有歌曲。任务未获发布授权时只留下提案。
- `sync.propose_setlist`：为本次任务范围内的演出提交新增歌单；同一场再次提交会替换上一次的提案。
- `changes.preview` / `changes.publish_automatic`：预览并发布本次任务提交的新增歌单。

后台对应的操作是音乐库的“新建歌曲”和“新增歌单”，以及 `/admin/changes` 中对提案的发布与丢弃。

## 4. 强制工作流

MCP server `instructions` 和配套 Codex skill/plugin 应规定：

1. 创建前先查询重复。
2. 事实更新必须提供来源。
3. AI 不确定时只创建草稿并标记警告。
4. 在发布前调用 `changes.preview`。
5. 普通身份的发布、下线、归档必须获得用户明确确认。专用每日自动化身份按维护者预先授予的任务权限发布活动；不具备下线和归档工具。
6. 工具失败时不得假装成功。
7. 返回 change set ID、活动 ID、公开 URL 和审计 request ID。

这些提示改善模型行为，但不能替代服务端权限和状态检查。

## 5. 幂等与并发

- 每个 propose/publish 请求带唯一 `idempotency_key`。
- 相同 key 的重试返回原结果，不创建重复记录。
- 更新 change set 保存 `base_version`。
- 发布时版本冲突返回当前记录及差异，不自动重试覆盖。
- 同一 change set 只能从 `proposed` 转换一次。

## 6. 审计

每次写操作记录：

- MCP 用户身份或后台用户身份。
- 客户端渠道 `mcp` / `admin`。
- 工具或后台动作名称。
- 目标活动/change set。
- before/after JSON。
- 来源 URL。
- request ID、idempotency key、时间和结果。

审计页面支持按活动、操作者、动作和日期筛选。

## 7. Codex 接入示例

OAuth Server 部署后，可以通过 Codex 添加：

```bash
codex mcp add frip-fan --url https://mcp.example.com/mcp
codex mcp login frip-fan
```

或使用项目级 `.codex/config.toml`：

```toml
[mcp_servers.frip_fan]
url = "https://mcp.example.com/mcp"
auth = "oauth"
default_tools_approval_mode = "writes"
```

项目级配置不包含 token。Codex 的写工具默认弹出确认，MCP 服务端仍独立检查 OAuth scope 和业务状态。

## 8. 测试要求

每个工具至少测试：

- 正常输入。
- 缺字段和非法枚举。
- 无 token、过期 token、错误 audience。
- scope 不足。
- 相同幂等键重试。
- 重复活动警告。
- 版本冲突。
- 已发布/已丢弃 change set 再次发布。
- 数据库写入失败时无部分提交。
- 工具结果不包含凭据或内部异常堆栈。
