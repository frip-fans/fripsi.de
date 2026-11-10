# 后台聊天编辑助手

`/admin/chat` 让维护者用自然语言查询和修改活动日历。推理循环运行在 OpenAI Agents API 一侧，模型通过本站 Remote MCP（`https://fripsi.de/mcp`）读取数据并提交提案；网站只负责签发短期身份、启动会话、读取进度和渲染结果。发布由人在聊天流里点击确认，不由模型调用。

与[官方活动自动同步](official-sync.md)共用 Agents API 客户端、预算记账和 MCP 工具层；区别是同步由 timer 无人驱动并可自动发布，聊天由登录维护者驱动且不能自动发布。

## 运行流程

```text
浏览器 /admin/chat（Cloudflare Access 保护）
  └─ POST /api/admin/chat            authenticateAdmin() → Actor
       ├─ 签发 fchat. 短期委派 token（scopes 不含 events:publish）
       ├─ 预算预留，再创建 Agents API session，挂载 MCP 工具
       └─ 写入 admin_chat_sessions（会话、身份、预算组、过期时间）
  └─ GET  /api/admin/chat/:id        读取 turn 进度与 MCP 调用记录
  └─ POST /api/admin/chat/:id        继续同一会话的下一轮输入
  └─ POST /api/admin/changes/:id/publish   人工点击「发布」，Access 身份直接写入
```

模型在 OpenAI 侧自行决定调用顺序与重试。网站不实现工具循环，也不把整库内容放进输入；数据一律由模型按需通过 MCP 查询，拿到的是实时 ID、来源和版本号。

## 身份与权限

聊天身份是一类独立的 MCP 凭据，与 OAuth 用户身份和自动同步身份并列：

- `POST /api/admin/chat` 先用 `authenticateAdmin` 验证 Cloudflare Access JWT，取得维护者邮箱与角色。
- 网站用 `AUTOMATION_SIGNING_SECRET` 签发前缀为 `fchat.` 的 HS256 JWT，subject 为维护者邮箱，audience 精确等于 `AUTOMATION_AUDIENCE`，`chat_session_id` 绑定本次会话，有效期与会话上限一致。
- `authenticateMcp` 在 `fsync.` 分支之后增加 `fchat.` 分支：校验签名、issuer、audience、subject、有效期，并查 `admin_chat_sessions` 确认该会话仍为 `active`。
- scopes 由服务端白名单夹住，固定为 `events:read` 与 `events:draft`，不读取 token 中声明的其它 scope。即使 token 被篡改或模型被来源页注入，也拿不到发布、下线、归档能力。
- 凭据只交给 OpenAI 的 MCP 传输配置，不写入数据库的会话输入，不进入日志和浏览器。

签名密钥与自动同步共用，因此轮换密钥会同时吊销该环境所有自动同步凭据和聊天会话。

## 批准发布

模型只能走 `changes.propose_*` → `changes.preview`，产出 change set。聊天流据此渲染 before/after 卡片，附「发布」与「丢弃」按钮：

- 「发布」提交到已有的 `/api/admin/changes/:id/publish`，凭 Access 身份执行，`channel=admin`、actor 为真人；版本冲突、幂等键、重复检测和审计仍由 `ChangeService` 执行。没有 `events:publish` 角色的维护者看到的卡片不含发布按钮。
- 发布或丢弃的结果作为下一轮输入回灌同一会话，模型据此继续；它无法仅凭自述推进发布状态。

不采用让模型持有 `changes.publish` 并以 `confirm=true` 自称已获确认的做法：那样「人类是否确认」只有模型的说法，来源页里的一句指令就足以绕过。确认这一步的信任根是 Access 会话加维护者的点击。

## 会话与过期

Agents API 的工具配置在 session 创建时固定，后续 turn 不能更换 MCP 凭据（`agent.session.input.message` 只提交输入）。凭据过期后该会话的全部 MCP 调用都会失败。因此：

- 会话硬上限 30 分钟，`admin_chat_sessions.expires_at` 到期后状态转为 `expired`，继续输入返回明确错误，由前端引导开新会话。
- 每个维护者同时只保留一个 `active` 会话，新建会话先关闭旧会话。
- 会话记录只保存 session ID、身份、预算组和时间，不保存对话正文；完整历史在 OpenAI 一侧。

## 预算

复用自动同步的预算表与 `Budget`，预算组为 `chat:<邮箱>:<日本日期>`，软上限由 `CHAT_BUDGET_USD` 配置，默认 1 美元。创建会话前预留，按 session/turn 幂等记录用量；超限拒绝新会话和新轮次，不中断已在进行的调用。与自动同步分组独立，互不挤占。预算是软控制，最终费用以 OpenAI 账单为准。

## 工具清单

聊天身份只挂载活动相关工具：

```text
events.search / events.get / events.list_upcoming / events.check_duplicate
changes.propose_create / propose_update / propose_status
changes.propose_unpublish / propose_archive / propose_restore
changes.preview / changes.discard
```

不挂载 `changes.publish`、`changes.publish_automatic` 和 `sync.*`。本期不包含歌曲、专辑和歌单：`ContentAdminService` 已有 `saveSong` / `saveRelease` / `saveSetlist`，但 MCP 尚无对应工具，需要另一期先扩展 change set 的 music 载荷。聊天不挂载 `web_search`；需要核对官方公告时由维护者粘贴链接和正文。

## 配置

`/etc/fripside/web.env` 新增：

| 名称 | 内容 |
|---|---|
| `OPENAI_API_KEY` | OpenAI 项目 API key，需具备 `api.agents.read`、`api.agents.write` |
| `CHAT_MODEL` | 聊天模型，默认 `gpt-6-luna` |
| `CHAT_BUDGET_USD` | 预算组软上限，默认 1 |
| `CHAT_ENABLED` | `true` 才开放 `/admin/chat` 与相关 API，默认 `false` |

已有的 `AUTOMATION_SIGNING_SECRET`、`AUTOMATION_AUDIENCE` 与 `MCP_ENDPOINT_URL` 继续使用，聊天不引入第二套密钥。key 只存在主机 0600 环境文件，不进 GitHub CI、仓库和浏览器。修改后需重启 `fripside-web.service`。

生产 `/mcp` 当前不在 Cloudflare Access 之后，OpenAI 可直接以 Bearer 凭据连接。若后续为 MCP 启用 Access，聊天需要与同步相同的 Service Token 请求头。

## 审计

写入通过共享 `ChangeService`，审计记录沿用现有字段：提案的 `actor_id` 为维护者邮箱、`channel=mcp`；发布的 `channel=admin`。`/admin/audit` 可按人和动作筛选，能区分「提案由聊天助手提交」和「发布由本人确认」。聊天流里的卡片不采信模型自述，而是按维护者身份和会话开始时间从 `change_sets` 实际记录中取待处理提案。

## 测试要求

沿用[管理后台与 MCP](admin-and-mcp.md) 第 8 节的矩阵，并补充：

- `fchat.` token 的签名、audience、subject、过期和会话失效校验。
- token 中声明 `events:publish` 时仍被白名单夹成只读加草稿。
- `CHAT_ENABLED=false` 时 `/admin/chat` 与 API 返回 404/503，不签发凭据。
- 预算超限拒绝创建会话，且不调用 OpenAI。
- 会话过期后继续输入的错误路径。
- 非 publisher 角色看不到发布按钮，且直接请求 publish 接口返回 403。
- 聊天输入和 MCP 返回不包含凭据、Access JWT 或异常堆栈。

本地测试使用模拟请求，不调用真实 OpenAI。OpenAI 无法访问开发机 localhost，端到端验收在 staging 的公网地址进行。

## 尚未验证

- 长会话的 token 用量增长曲线与 `CHAT_BUDGET_USD` 默认值是否合适，验收后调整。
- 轮询间隔与首字延迟的实际体验。本期用轮询读取 turn 状态，不接 SSE 流式输出。

参考：[Agents API MCP](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp)、[Agents API quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart)。
