# fripSide Fan Site

一个独立的 fripSide 粉丝活动日历。公开网站、站内管理后台和 Remote MCP 共用 Cloudflare D1，内容维护不依赖 Notion，也不需要每次更新都重新构建网站。

当前状态：MVP 已实现，可在本地完整运行；正式域名、Cloudflare D1 ID、Access 应用和历史 CSV 尚待接入。

## 已实现

- Astro SSR 公开站：首页、月历、年份归档、活动详情、歌单库、About、sitemap。
- 公开 UI 支持简体中文、繁体中文、日语和英语；语言选择写入 Cookie，并在当前筛选 URL 上切换。
- Bootstrap Icons 本地 SVG 图标系统，不依赖 CDN、React 或 Bootstrap CSS。
- 完整公开 iCalendar 订阅源：`/calendar.ics`，支持活动更新、延期和取消同步。
- D1 migrations：活动、来源、变更提案、审计、幂等回执和导入任务。
- 站内管理后台：活动直接保存、Setlist/专辑编辑、AI 提案审核、归档、审计和 CSV 导出。
- Remote MCP Worker：13 个受控工具、OAuth resource metadata、Bearer JWT 校验和 scope 校验。
- AI 提案工作流：重复检查 → propose → preview → 明确确认 → publish。
- 人工维护工作流：表单保存 → D1 条件写入 → audit log；关闭“公开显示”即可暂存在后台，不再额外创建人工草稿。
- Notion CSV 一次性离线转换与可复现 SQL 生成。
- 歌曲/版本/发行物/Live 歌单数据模型、交叉查询与幂等 CSV 导入。

## 本地启动

需要 Node.js 24。

```bash
npm install
cp apps/web/.dev.vars.example apps/web/.dev.vars
cp apps/mcp/.dev.vars.example apps/mcp/.dev.vars
npm run db:migrate:local
npm run db:seed:local
npm run dev:web
```

网站默认位于 `http://localhost:4321`，后台位于 `http://localhost:4321/admin`。复制得到的 `.dev.vars` 被 Git 忽略，仅用于开启本地测试身份；生产环境绝不能配置 `DEV_AUTH_BYPASS=true`。

另开终端启动 MCP：

```bash
npm run dev:mcp
```

MCP endpoint 为 `http://localhost:8787/mcp`，健康检查为 `/health`。本地 Web 与 MCP 共享同一份 Wrangler D1 持久化目录。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

## 迁移 Notion 历史数据

先从 Notion 导出 CSV，把原文件放到被 Git 忽略的 `data/raw/`：

```bash
npm run import:notion -- data/raw/export.csv
npm run import:sql
```

第一条命令输出规范化 JSON 和核验报告，第二条生成可重复执行的 `data/normalized/import.sql`。先阅读 `data/reports/notion-import.json`，确认数量、日期范围、分类和排除项，再导入本地或 dev D1。

详细方案和部署步骤见 [docs/README.md](./docs/README.md) 与 [docs/deployment.md](./docs/deployment.md)。

歌单库的数据准备与导入方式见 [docs/music-library.md](./docs/music-library.md)。
