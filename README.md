# fripSi.de

[简体中文](./README.md) | [日本語](./README.ja.md) | [English](./README.en.md)

[fripSi.de](https://fripsi.de) 是一个由粉丝维护的非官方 fripSide 活动日历与 Live 歌单资料库。

项目用于整理公开发布的活动、发行物、歌曲版本与演唱记录。内容保存在 SQLite 数据库中，通过站内后台维护；更新资料不需要重新构建网站。

> 本站并非 fripSide 官方网站，也不代表或隶属于 fripSide 及其相关机构。官方信息请以 [fripside.net](https://fripside.net) 为准。

## 功能

- 按月份浏览活动，并通过公开的 iCalendar 地址订阅日历。
- 按年份、类型、地点和关键词查询历史活动。
- 在 Live Journey 世界地图上拖动时间轴，播放历年实体活动轨迹。
- 浏览 Live 歌单、专辑曲目、歌曲版本及相互之间的关联。
- 通过社区页面和嵌入式 GitHub Discussions 参与公开讨论。
- 使用“八木沼悟志浓度检测器”互动页面生成趣味检测结果。
- 支持简体中文、繁体中文、日语和英语界面。
- 通过 `/admin` 管理活动、歌曲、专辑和歌单。
- 记录资料来源和管理操作，方便核查与修正。
- 提供 Remote MCP（`/mcp`），用于查询资料和提交待审核的内容变更。
- 提供可选的 OpenAI Agents API 同步任务，每天检查官方活动公告，校验后自动发布，并可通过 Bark 接收有更新通知。

## 技术栈

- [Astro](https://astro.build/) SSR，生产使用 Node 24 standalone 运行
- SQLite（Node 内置 `node:sqlite`）
- Cloudflare DNS/CDN、Access 与 Tunnel
- TypeScript、Vitest、Playwright
- Bootstrap Icons（构建时作为本地 SVG 引入）
- Leaflet + OpenStreetMap（交互地图与底图）

项目不依赖 React，也不把 Notion 或其他第三方服务作为在线数据源。

## 仓库结构

```text
apps/
├── web/          Astro 网站、管理后台和 Web API
├── mcp/          Remote MCP 协议与工具（由网站进程在 /mcp 调用）
└── sync/         官方活动自动同步任务（默认关闭）
packages/
├── core/         数据访问、校验、权限和共享业务逻辑
└── node-runtime/ SQLite 与本地文件存储适配
migrations/       数据库迁移
ops/              主机部署脚本与数据库备份
scripts/          数据抓取、清洗和导入脚本
data/             导入模板与研究数据
docs/             架构、数据模型和部署文档
```

## 本地开发

需要 Node.js 24 和 npm。本地开发与生产使用同一套 Node 运行时和 SQLite。

```bash
git clone https://github.com/frip-fans/fripsi.de.git
cd fripsi.de
npm install

cp apps/web/.env.local.example apps/web/.env.local

npm run db:migrate:local   # 创建 apps/web/.cache/self-hosted/site.sqlite 并应用 migrations
npm run db:seed:local      # 写入示例数据
npm run dev:web
```

默认情况下，网站运行在 `http://localhost:4321`，管理后台位于 `http://localhost:4321/admin`，MCP 位于 `http://localhost:4321/mcp`。`.env.local` 中的 `DEV_AUTH_BYPASS` 只在开发模式下生效，用于提供本地测试身份；其他环境会被强制关闭。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev:web` | 启动网站开发服务器 |
| `npm run typecheck` | 检查所有 workspace 和数据脚本的类型 |
| `npm test` | 运行测试 |
| `npm run build` | 生成生产使用的 Node 构建（`apps/web/dist-node`，含同步任务） |
| `npm run visual:check` | 使用 Playwright 检查首页视觉状态 |
| `node scripts/visual-check-journey.mjs` | 检查 Journey 桌面端／移动端地图与播放交互 |
| `npm run db:migrate:local` | 将 migrations 应用到本地数据库 |
| `npm run db:seed:local` | 写入本地示例数据 |
| `npm run db:import:local -- <file.sql>` | 把生成的导入 SQL 写入本地数据库 |

## 数据维护

活动、歌曲、发行物和歌单均以各环境的数据库为准。批量资料先整理成仓库约定的 CSV，再通过导入脚本生成或写入结构化数据。提交资料修正时，请同时提供可公开访问的来源链接。

- [歌单库的数据结构与导入格式](./docs/music-library.md)
- [数据库模型](./docs/data-model.md)
- [管理后台与 MCP](./docs/admin-and-mcp.md)
- [官方活动自动同步](./docs/official-sync.md)

从 Notion 迁移旧活动数据时，可使用：

```bash
npm run import:notion -- data/raw/export.csv
npm run import:sql
```

原始导出文件放在被 Git 忽略的 `data/raw/`。执行导入前，请先检查生成的核验报告和 SQL。

## 部署

生产站和测试站分别运行在独立的 OCI 主机上：Node 24 运行 Astro standalone 构建，网站进程同时提供 `/mcp`，数据保存在本机 SQLite，Cloudflare 负责 DNS/CDN、Access 和 Tunnel。构建和部署由私有部署仓库的工作流完成，配置与密钥只保存在主机上。

代码先通过任务 PR 进入 staging，完成 CI 与测试站验收后，从最新 master 创建 `release/*` 分支并对齐已验收 staging 内容，再通过 **Rebase and merge** 合入 master。增量数据库迁移在部署时执行（生产需要显式批准）。详见 [发布流程](./docs/release-workflow.md)、[部署与运维](./docs/oci-deployment.md)、[数据库备份](./docs/sqlite-backups.md) 和 [项目协作约定](./AGENTS.md)。

## 参与项目

欢迎通过 [Issues](https://github.com/frip-fans/fripsi.de/issues) 提交功能建议、资料纠错或问题报告，也可以直接发起 Pull Request。

提交代码前请运行：

```bash
npm run typecheck
npm test
npm run build
```

修改界面文字时，请同步维护四种语言；修改活动或音乐资料时，请附上来源并避免提交未经授权的图片、音频或大段受版权保护的文本。

## 许可与权利说明

本仓库中的代码以 [GNU General Public License v3.0](./LICENSE) 发布。

fripSide 的名称、标识、作品以及其他相关素材的权利归各自权利人所有。GPL 仅适用于本仓库中可授权的代码，不对第三方名称、作品、数据来源或媒体素材授予额外许可。
