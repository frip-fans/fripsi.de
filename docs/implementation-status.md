# 实现状态

最后更新：2026-07-18

## 已完成

### 项目基础

- npm workspaces：`apps/web`、`apps/mcp`、`packages/core`。
- Astro 7 SSR + `@astrojs/cloudflare` 14，使用当前统一 Worker entrypoint。
- 独立 Remote MCP Worker，使用 Streamable HTTP `/mcp`。
- TypeScript strict、Vitest、GitHub Actions CI、统一 build/typecheck/test 命令。

### 数据与业务规则

- `events`、`event_sources`、`change_sets`、`audit_logs`、`operation_receipts`、`import_jobs` migrations。
- Zod 结构校验、HTTPS 来源要求、日期区间校验和枚举约束。
- 重复候选、幂等 propose/publish、乐观锁和条件写入。
- create/update/status/unpublish/archive/restore 全部经过 change set。
- 写操作保存操作者、渠道、请求 ID 和 before/after 审计。

### 公开网站

- 首页近期活动和空状态。
- 桌面月历、移动端时间线、月份和分类筛选。
- 年份归档、活动详情和来源链接。
- 完整公开 iCalendar 订阅源、稳定活动 UID、延期/取消同步和日历页订阅入口。
- About、404、robots.txt 和动态 sitemap。
- 响应式深色视觉系统和键盘可用的原生控件。
- 统一的 Bootstrap Icons 本地 SVG 组件，不加载图标字体或外部 CDN。

### 管理后台

- Cloudflare Access JWT 服务端验证和本地开发身份开关。
- editor/publisher scope 区分。
- 活动搜索、筛选、创建和修改表单。
- 变更预览、重复警告、发布和丢弃。
- 状态、下线、归档和恢复提案。
- 审计浏览与 UTF-8 CSV 导出。

### MCP

- 每个 HTTP 请求创建新的 `McpServer`，避免跨客户端共享连接状态。
- OAuth protected resource metadata 与 Bearer JWT 验证。
- `events.search`、`events.get`、`events.list_upcoming`、`events.check_duplicate`。
- `changes.propose_create/update/status/unpublish/archive/restore`。
- `changes.preview`、`changes.publish`、`changes.discard`。
- 工具 annotations、服务端 scope 检查和 `confirm: true` 发布门槛。

### 历史数据迁移

- Notion CSV 离线解析，不产生运行时 Notion 依赖。
- 稳定 legacy ID/slug、标签分类映射、取消/延期识别和来源 URL 提取。
- 数量、日期范围、分类、排除项和缺少来源报告。
- 可重复执行的 D1 SQL 与逐项 import audit log。

## 已执行验证

- 全部 workspace 类型检查通过。
- 11 个 schema/utility/iCalendar 测试通过。
- Web SSR 与 MCP Worker 构建通过。
- 两个 D1 migration 在本地 workerd 实际执行成功。
- 公开首页、月历和 `/admin` 均返回 HTTP 200。
- `/calendar.ics` 实际返回公开 D1 活动，CRLF、MIME、ETag 和 304 缓存响应均已核验。
- 实际完成一次后台“创建提案 → 预览 → 发布 → 公开详情”流程。
- 发布结果核验为 `published=1`、一个来源和一条 event 发布审计。
- MCP initialize、tools/list 和 `events.list_upcoming` 实际调用成功，读取到与 Web 相同的 D1 数据。
- 内置 Notion CSV fixture：4 行输入，2 行规范化、2 行正确排除，并成功生成 SQL。

## 上线前必须完成

1. 确定 MCP 子域名并替换 MCP Wrangler 中的 `mcp.example.com`。
2. 创建 `frip-fan-prod` D1，并替换 production `database_id` 占位值。
3. 创建 Cloudflare Access Admin 应用，配置 team domain、AUD 和 publisher 邮箱。
4. 配置 MCP OAuth/Access resource，确认客户端能完成授权并获得正确 scopes。
5. 提供完整 Notion CSV，核验约 369 条旧数据后导入 dev，再导入 production。
6. 在生产环境运行发布前检查和备份步骤。

## MVP 后续项

- 管理后台内的 CSV 上传与两步确认；当前使用仓库离线脚本，安全性和可复现性更高。
- R2 图片上传与长期备份。
- 更完整的审计筛选、监控告警和恢复演练。
- 旧 slug 重定向、RSS 和更细角色。
