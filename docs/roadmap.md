# 实施路线图

当前进度（2026-07-18）：Phase 0、公开网站和核心管理/MCP 流程已完成；历史数据正式迁移、生产 OAuth 配置和 Phase 5 加固仍待执行。详细证据见 [实现状态](./implementation-status.md)。

## 交付原则

- 先建立可验证的数据基础，再做视觉和 AI 能力。
- 每一阶段都应能独立运行和验收。
- 不以“功能能点开”作为完成标准，必须包含权限、错误路径、测试和恢复能力。
- MCP 在管理后台稳定之后接入，避免 AI 成为第一套未经验证的写入口。

## Phase 0：项目基础（已完成）

交付：

- Workspace/monorepo 脚手架。
- `apps/web` Astro + Cloudflare adapter。
- `apps/mcp` Worker 空服务。
- `packages/core` 类型和 Zod schema。
- local/dev/prod 环境约定。
- lint、typecheck、test、build 命令。

验收：

- 两个 Worker 可独立本地运行和构建。
- Web/MCP 都能访问本地 D1 binding。
- CI 能执行 lint、typecheck 和测试。

## Phase 1：D1 与旧数据迁移（基础完成，正式 CSV 待提供）

交付：

- `events`、`event_sources`、`change_sets`、`audit_logs` migrations。
- Notion CSV 解析、清洗、验证和 D1 导入脚本。
- 迁移报告和异常清单。
- CSV 全量导出脚本。

验收：

- 约 369 条原始记录可完整对账。
- 所有导入活动均通过 schema。
- 日期范围、分类数量和异常记录有报告。
- 相同输入重复导入不会生成重复活动。
- dev D1 可完整导出并重新导入。

## Phase 2：公开网站（MVP 已完成）

交付：

- 首页。
- Calendar 月历/移动端列表。
- Archive 年份归档。
- 活动详情页和来源。
- 分类、状态和年份筛选。
- About、404、SEO、sitemap。

验收：

- 仅展示 published 且未归档活动。
- 日期区间、同日多条、取消/延期样式正确。
- 没有未来活动时首页和日历有合理空状态。
- 键盘导航、颜色对比和移动端布局达到可用标准。
- Lighthouse/性能检查没有明显阻塞问题。

## Phase 3：管理后台（MVP 已完成）

交付：

- Cloudflare Access 保护 `/admin` 和 `/api/admin`。
- 活动列表、搜索、过滤。
- 创建/编辑表单。
- change set 预览、发布、丢弃。
- 取消、延期、下线、归档、恢复。
- 来源管理。
- CSV 验证预览、导入和导出。
- audit log 浏览。

验收：

- 未授权用户无法访问页面和 API。
- editor 无法执行 publisher 操作。
- 所有写操作生成 audit log。
- 版本冲突不会静默覆盖。
- 危险操作可恢复，界面无硬删除入口。

## Phase 4：Remote MCP（工具完成，生产 OAuth 待配置）

交付：

- Streamable HTTP `/mcp`。
- Cloudflare Access OAuth 2.1。
- `events.*` 只读工具。
- `changes.propose_*`、`preview`、`publish`、`discard` 工具。
- 工具 annotations、scopes 和 server instructions。
- Codex 项目配置示例。
- MCP Inspector 和集成测试。

验收：

- Codex 能完成“查询 → 检查重复 → 创建提案 → 预览 → 确认发布”。
- 没有明确确认时停留在 proposed。
- scope 不足时服务端拒绝，而不是只依赖客户端隐藏工具。
- 相同幂等键不会重复创建/发布。
- 过期版本发布返回冲突。
- 工具结果和日志不泄漏 token 或内部配置。

## Phase 5：生产加固

交付：

- 自定义域名和 HTTPS。
- Worker 日志与告警。
- D1 Time Travel 恢复 runbook。
- 定期 CSV/R2 备份。
- 速率限制和异常请求保护。
- 数据质量检查任务。
- 发布前 smoke test。

验收：

- 完成一次误发布恢复演练。
- 完成一次 D1 恢复或导出重导演练。
- MCP OAuth 凭据轮换流程可执行。
- Web 与 MCP 任一部署失败不会损坏 D1 数据。

## 第一版不做

- 通用文章 CMS。
- 评论、用户注册、社区论坛。
- 售票或支付。
- 站内 AI 聊天框。
- 自动抓取所有社交媒体公告。
- AI 无确认批量发布。
- 多租户和复杂组织权限。
- 图片生成和大型媒体库。
- 完整多语言翻译系统。

## 后续候选

- R2 图片上传和裁切。
- 活动 `.ics` 下载。
- 旧 slug 重定向。
- 更细的角色和审批人机制。
- 关注分类后的邮件/RSS 通知。
- 定期数据质量报告。
- MCP UI 预览组件，让 ChatGPT 内直接显示活动 diff。
- 站内基于 Responses API 的编辑助手；它仍复用 MCP/业务服务，不新开绕过权限的写路径。

## 开始实现前仍需确认

以下属于配置或产品选择，不改变总体架构：

1. 正式域名，以及 MCP 子域名。
2. GitHub 仓库 owner 和 Cloudflare account owner。
3. 首批 editor/publisher 邮箱。
4. 是否保留活动具体时间；若保留，旧数据缺失时间如何展示。
5. Notion 原始 CSV 的交付方式和保存策略。
6. 网站第一版界面语言与免责声明文本。
