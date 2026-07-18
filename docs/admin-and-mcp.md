# 管理后台与 MCP

## 1. 共同业务层

管理后台和 MCP 是两种操作界面，但必须调用同一套服务：

```text
Admin API ─┐
           ├─> EventService / ChangeService ─> D1
MCP Tools ─┘
```

共享服务负责：

- 输入 schema 和字段规范化。
- 权限判断。
- 重复检测。
- 来源要求。
- 幂等和乐观锁。
- change set 发布事务。
- audit log。

不能只在前端或 MCP 工具描述中声明规则；服务端必须再次执行。

## 2. 管理后台

### 2.1 身份

`/admin/*` 和 `/api/admin/*` 使用 Cloudflare Access 保护。允许登录方式可从邮件一次性验证码开始，后续接入 GitHub/Google。

Worker 接到请求后仍需验证 `Cf-Access-Jwt-Assertion`：

- 签名有效。
- issuer 匹配 Access team domain。
- audience 匹配本应用 AUD。
- token 未过期。
- email/identity 满足应用角色要求。

### 2.2 角色

第一版定义两个逻辑角色：

| 角色 | 权限 |
|---|---|
| editor | 查询、创建草稿、编辑草稿、预览、导入验证 |
| publisher | editor 的全部权限，加发布、下线、归档、正式导入 |

身份来源和角色映射可以先通过 Access policy/配置完成，不急于创建站内用户密码表。

### 2.3 页面与行为

活动表格支持：

- 标题、日期、场地和来源搜索。
- 分类、状态、年份、发布状态过滤。
- 默认按日期倒序，近期活动可单独切换正序。
- 显示来源、最后修改人、版本号和待处理 change set。

编辑表单支持：

- 单日或日期区间。
- 全天或具体时间。
- 分类和细分类。
- 状态、场地、地区、备注。
- 多个来源 URL。
- 草稿保存、预览、发布。

危险操作必须二次确认，并显示影响：

- 下线：公开站点将不可见。
- 取消/延期：仍公开显示，但状态改变。
- 归档：从公开站点和默认后台列表移除，可恢复。

不提供硬删除按钮。

## 3. Remote MCP

### 3.1 定位

MCP 让 Codex、ChatGPT 或其他兼容客户端成为受控编辑助手。网站本身不需要调用 OpenAI API，也不需要在前台内置聊天框。

典型对话：

```text
用户：这是官方公告链接，请把 8 月 31 日的活动加进去。
AI：我找到一个同日同场地的相似活动。以下是拟新增内容和差异，是否发布？
用户：是，发布。
AI：已发布，并返回公开活动 URL。
```

### 3.2 Transport 与认证

- Endpoint：`https://mcp.example.com/mcp`
- Transport：Streamable HTTP
- Authentication：OAuth 2.1
- OAuth provider：优先 Cloudflare Access OAuth Provider
- 匿名调用：不允许

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

网页查证由 AI Client 自己完成。MCP 只接收结构化数据和来源 URL，避免服务端成为任意 URL 抓取器或 SSRF 入口。

## 4. 强制工作流

MCP server `instructions` 和配套 Codex skill/plugin 应规定：

1. 创建前先查询重复。
2. 事实更新必须提供来源。
3. AI 不确定时只创建草稿并标记警告。
4. 在发布前调用 `changes.preview`。
5. 发布、下线、归档必须获得用户明确确认。
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
- D1 写入失败时无部分提交。
- 工具结果不包含凭据或内部异常堆栈。

