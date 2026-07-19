# fripSide Fan Site 技术方案

状态：MVP 已实现，待接入正式资源与历史数据
最后更新：2026-07-19

本目录记录 fripSide 粉丝站当前已经收敛的产品与技术方案。目标是建设一个简洁、易维护的活动日历网站，并同时提供人工管理后台和受控的 AI/MCP 编辑能力。

## 文档导航

- [总体架构](./architecture.md)：系统边界、组件、请求流和关键技术选择。
- [数据模型](./data-model.md)：D1 表结构、约束、状态与 Notion 旧数据迁移方案。
- [管理后台与 MCP](./admin-and-mcp.md)：人工编辑流程、MCP 工具、权限与安全规则。
- [部署与运维](./deployment.md)：Cloudflare 部署、环境、密钥、备份和监控。
- [实施路线图](./roadmap.md)：分阶段交付、验收标准和暂不实施的功能。
- [实现状态](./implementation-status.md)：已经完成的能力、验证证据和上线前剩余事项。
- [歌单库](./music-library.md)：歌曲、版本、发行曲目、Live 歌单、交叉查询和 CSV 导入。

## 已确定的决策

1. **Cloudflare D1 是唯一内容数据源。** Notion 只用于一次性导出现有数据，迁移后不再作为运行依赖。
2. **使用 Cloudflare Workers，而不是传统 Cloudflare Pages。** 前台需要 Astro SSR、D1 binding 和管理 API；Cloudflare 也建议新项目优先使用 Workers Static Assets。
3. **管理后台属于网站本身。** `/admin` 提供活动、Setlist、专辑的直接编辑，以及 AI 提案审核、导入导出和审计记录。
4. **MCP 单独部署为 Remote MCP Worker。** 它与网站共用业务规则和 D1，但不与公开路由混在同一个运行入口。
5. **AI 采用“提案优先”模型。** AI 先创建 `change_set`，预览后才允许发布；不直接修改数据库行。
6. **可信人工维护者直接保存。** 人工表单不再重复经过草稿提案；服务端仍执行权限、校验、乐观锁、幂等和审计。需要暂存时使用 `published = 0`。
7. **所有写操作都可追踪。** 保存操作者、来源、变更前后数据、请求 ID 和时间。
8. **不向 AI 暴露 SQL、通用 HTTP 请求或硬删除工具。** 删除统一转为可恢复的归档。
9. **身份认证交给 Cloudflare Access/OAuth。** 不自行实现密码、密码找回或会话系统。
10. **内容更新不触发重新构建。** 发布后写入 D1，前台通过 SSR/API 读取最新数据。
11. **数据必须可迁移。** 使用 SQLite 兼容的简单表结构、仓库内 SQL migration，并提供 CSV 导入导出。
12. **歌单库区分作品与版本。** Live 演唱先关联作品；只有来源明确时才精确关联到具体录音或编曲版本。

## 目标架构摘要

```mermaid
flowchart LR
    Visitor[公开访客] --> Web[Astro Web Worker]
    Editor[维护者] --> Access[Cloudflare Access]
    Access --> Admin[/admin]
    Admin --> Web
    AI[Codex / ChatGPT / MCP Client] --> OAuth[OAuth 2.1]
    OAuth --> MCP[Remote MCP Worker]
    Web --> Core[共享业务规则]
    MCP --> Core
    Core --> D1[(Cloudflare D1)]
    Web -. 可选图片 .-> R2[(Cloudflare R2)]
```

## 核心原则

- 前台以浏览体验、移动端和可访问性为优先。
- 后台以低学习成本和防误操作为优先。
- AI 能完成高频维护，但发布权必须可控。
- 业务规则必须在服务端执行，不能只依赖 AI 提示词或前端校验。
- 构建与部署失败不能影响已上线内容；数据库迁移必须可回滚或可恢复。

## 官方参考

- [Cloudflare：新静态项目优先使用 Workers Static Assets](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare：Astro on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)
- [Cloudflare：D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare：构建 Remote MCP Server](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [Cloudflare：MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)
- [OpenAI：构建 MCP Server](https://developers.openai.com/apps-sdk/build/mcp-server)
- [OpenAI：MCP 工具设计](https://developers.openai.com/apps-sdk/plan/tools)
- [OpenAI：MCP OAuth 认证](https://developers.openai.com/apps-sdk/build/auth)
- [Codex：MCP 配置](https://learn.chatgpt.com/docs/extend/mcp)
