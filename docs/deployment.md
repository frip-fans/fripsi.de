# 部署与运维

## 1. Cloudflare 资源

生产环境计划使用：

| 资源 | 用途 |
|---|---|
| Web Worker | Astro SSR、静态资源、公开页面、Admin/API |
| MCP Worker | Remote MCP `/mcp`、OAuth 和工具调用 |
| D1 `frip-fan-prod` | 正式活动、change set、来源和审计 |
| D1 `frip-fan-dev` | 本地/开发和迁移演练 |
| Cloudflare Access | `/admin` 和 MCP OAuth 身份入口 |
| R2（后续） | 活动图片和长期数据库导出 |
| Workers Builds | GitHub push 后构建和部署两个 Worker |

## 2. 域名

建议域名布局：

```text
https://example.com                 # 公开网站
https://example.com/admin           # Access 保护的管理后台
https://example.com/api/admin/*     # Access 保护的管理 API
https://mcp.example.com/mcp         # OAuth 保护的 Remote MCP
```

MCP 使用独立子域，便于设置独立 OAuth resource、CORS/安全策略、日志和故障隔离。

## 3. Git 与构建

GitHub 是代码和 migration 的权威来源，不是活动内容数据源。

Workers Builds 连接同一个仓库中的两个项目：

- Web 项目监听 `apps/web/**`、`packages/core/**`、相关 migration/配置。
- MCP 项目监听 `apps/mcp/**`、`packages/core/**`、相关配置。

预计命令：

```text
npm run build:web
npm run deploy:web
npm run build:mcp
npm run deploy:mcp
```

具体命令在脚手架确定后写入根 `package.json`。依赖版本通过 lockfile 固定，Node 版本通过 `.node-version` 或 Workers Builds 变量固定。

当前脚手架已经确定，使用 Node 24 和 npm lockfile：

```text
npm ci
npm run typecheck
npm test
npm run build
npm run deploy:web
npm run deploy:mcp
```

Astro 7 / Cloudflare adapter 14 使用统一 entrypoint：

```text
@astrojs/cloudflare/entrypoints/server
```

Cloudflare binding 从 `cloudflare:workers` 的 `env` 读取，不再使用旧版 `Astro.locals.runtime.env`。

Astro 6+ 在 build 阶段解析 Cloudflare environment，因此 Web production 构建必须携带：

```text
CLOUDFLARE_ENV=production
```

仓库中的 `npm run deploy:web` 已包含该变量。不能先做默认 dev build，再只给 `wrangler deploy` 添加 `--env production`，否则产物仍可能绑定 dev D1。

## 4. 环境与 binding

### Web Worker

```text
DB                  D1 binding
ACCESS_TEAM_DOMAIN  Cloudflare Access issuer
ACCESS_AUD          Admin application audience
SITE_URL            公开站点 canonical URL
```

可选：

```text
MEDIA               R2 binding
```

### MCP Worker

```text
DB                  同一个 production D1 binding
MCP_RESOURCE_URL    https://mcp.example.com
ACCESS_TEAM_DOMAIN  OAuth/Access issuer
MCP_AUDIENCE        MCP resource audience
```

需要保密的值放入 Cloudflare Secrets/Build Secrets，不提交到仓库。公开的域名和 binding 名可以写入 `wrangler.jsonc`。

MCP 模式本身不需要 `OPENAI_API_KEY`：模型运行在 Codex/ChatGPT 等 MCP Client 中。只有未来要在 `/admin` 内嵌自有 AI 聊天时，才另行接入 OpenAI Responses API 和 API key。

## 4.1 第一次部署配置

两个 `wrangler.jsonc` 都保留了全零 `database_id`，故意防止误部署。拿到 Cloudflare account 后：

```bash
npx wrangler login
npx wrangler d1 create frip-fan-dev
npx wrangler d1 create frip-fan-prod
```

把命令返回的 ID 分别写入：

- `apps/web/wrangler.jsonc` 的默认 dev binding 与 `env.production`。
- `apps/mcp/wrangler.jsonc` 的默认 dev binding 与 `env.production`。

再把 `SITE_URL`、`MCP_RESOURCE_URL`、`MCP_AUTHORIZATION_SERVER` 的占位域名替换为正式域名。

生产 migration 必须先于应用部署单独执行：

```bash
npx wrangler d1 migrations apply frip-fan-prod \
  --remote --env production --config apps/web/wrangler.jsonc
```

### Admin Access

在 Cloudflare Zero Trust 中为以下路径创建 self-hosted application：

```text
example.com/admin/*
example.com/api/admin/*
```

为 Web production Worker 配置：

```text
ACCESS_TEAM_DOMAIN
ACCESS_AUD
ADMIN_PUBLISHERS       逗号分隔的 publisher 邮箱
```

应用外层 Access policy 与 Worker 内 JWT 校验必须同时保留。不要在 production 设置 `DEV_AUTH_BYPASS`。

### MCP OAuth resource

MCP Worker 暴露：

```text
GET /.well-known/oauth-protected-resource
POST /mcp
```

production 需要配置：

```text
ACCESS_TEAM_DOMAIN
MCP_AUDIENCE
MCP_AUTHORIZATION_SERVER
MCP_RESOURCE_URL
SITE_URL
```

授权完成后至少用 MCP Inspector 或 Codex 验证 initialize、tools/list、只读查询和一次未发布提案，再授予 publish scope。

## 5. 数据库 migration

Migration 存放在：

```text
migrations/
├── 0001_initial.sql
├── 0002_*.sql
└── ...
```

规则：

1. 先在本地 D1 应用并运行测试。
2. 再在 dev/staging D1 演练和导入样本数据。
3. production migration 作为单独受控步骤执行。
4. 应用代码不得在普通请求中自动运行 migration。
5. 破坏性 migration 必须先导出数据并记录恢复点。
6. 优先采用向后兼容的两阶段变更：先加字段/表并兼容，再迁移数据，最后删除旧结构。

`0004_structured_locations.sql` 是一次明确批准的破坏性切换：当前没有外部用户依赖旧地点契约，因此 migration 会在同一步中迁移旧 `venue`/`region`、生成结构化场馆和渠道、记录无法自动拆分的待办，随后删除旧列。执行 production migration 前必须：

1. 导出完整 D1 备份并记录恢复点。
2. 在备份副本上运行 migration，确认 `PRAGMA foreign_key_check` 为空。
3. 记录迁移前后活动总数以及 `venues`、`event_venues`、`event_channels`、`location_migration_backlog` 数量。
4. migration 成功后立即部署同时版本的 Web 与 MCP；旧应用代码不能在新 schema 上运行。

参考：[Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)

## 6. 初始数据迁移

迁移过程不在 Cloudflare Dashboard 中手工执行。仓库提供可复现脚本：

```text
scripts/import-notion-export.ts
scripts/build-import-sql.ts
```

建议生成但不提交包含敏感内部信息的中间文件；原始 Notion CSV、清洗报告和最终导入文件的保存位置在实施前确认。公开活动数据本身可以作为迁移 artifact 保存。

导入顺序：

1. 离线解析 Notion CSV。
2. 输出规范化 JSON/CSV 和异常清单。
3. 在 dev D1 dry run。
4. 对账并人工抽查。
5. 记录 production D1 Time Travel bookmark。
6. 正式批量导入。
7. 再次运行数量、分类、日期和重复检查。

## 7. 备份与恢复

### MVP

- 使用 D1 Time Travel；Free 计划保留窗口以 Cloudflare 当前限制为准。
- 后台提供全量 CSV 导出。
- 正式批量导入和重大 migration 前手动导出。
- audit log 与业务数据一起保留。

### 后续

- 每周将 D1 导出到 R2，长期保存。
- 定期验证导出可重新导入，而不是只确认文件存在。
- 编写恢复 runbook，记录 Time Travel、CSV/SQL 恢复步骤。

参考：[Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

## 8. 可观测性

Worker 日志必须包含：

- `request_id`
- route/tool name
- actor ID（不记录 token）
- change set/event ID
- duration
- result status
- 错误类别

不得包含：

- OAuth access/refresh token
- Cloudflare Access JWT
- Cookie
- Cloudflare Secret
- 完整 authorization header
- 未经需要的完整 AI prompt

需要监控的指标：

- Web 5xx 和 D1 错误率。
- MCP 工具成功/失败率。
- OAuth 失败率。
- change set 从创建到发布的时间。
- 版本冲突和重复警告数量。
- D1 用量和 Worker 请求量。

## 9. 安全响应

### MCP OAuth 或凭据疑似泄漏

1. 立即撤销/轮换对应 token 或 OAuth client secret。
2. 检查 MCP/audit logs 中异常调用。
3. 暂时移除 `events:publish`、`events:archive` scope。
4. 对可疑变更执行下线/恢复。
5. 必要时使用 D1 Time Travel 恢复。

### 误发布

1. 通过后台下线活动，不硬删除。
2. 审查 change set 和 audit log。
3. 创建修正 change set。
4. 发布修正并保留完整历史。

## 10. 发布检查清单

### Web

- [ ] 公开查询不会返回 draft、unpublished、archived 记录。
- [ ] `/admin` 和 `/api/admin` 未登录时被拦截。
- [ ] 服务端验证 Access JWT。
- [ ] canonical URL、404、robots 和 sitemap 正确。
- [ ] 移动端日历和无未来活动状态正常。

### MCP

- [ ] `/mcp` 不允许匿名写操作。
- [ ] OAuth metadata、resource、audience 和 scopes 正确。
- [ ] 工具 annotations 与真实副作用一致。
- [ ] 写工具要求幂等键。
- [ ] publish/unpublish/archive 需要明确权限。
- [ ] 不存在 SQL、任意 fetch 或硬删除工具。

### 数据

- [ ] migrations 已在 dev D1 验证。
- [ ] 已记录 production 恢复点。
- [ ] 旧数据迁移完成对账。
- [ ] 导出与恢复流程至少演练一次。

## 11. 官方参考

- [Workers Builds Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)
- [Workers Builds configuration and secrets](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Astro on Cloudflare Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
