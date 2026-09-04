# fripSi.de

[简体中文](./README.md) | [日本語](./README.ja.md) | [English](./README.en.md)

[fripSi.de](https://fripsi.de) 是一个由粉丝维护的非官方 fripSide 活动日历与 Live 歌单资料库。

项目用于整理公开发布的活动、发行物、歌曲版本与演唱记录。内容保存在 Cloudflare D1 中，通过站内后台维护；更新资料不需要重新构建网站。

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
- 提供独立的 Remote MCP Worker，用于查询资料和提交待审核的内容变更。

## 技术栈

- [Astro](https://astro.build/) SSR
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- TypeScript、Vitest、Playwright
- Bootstrap Icons（构建时作为本地 SVG 引入）
- Leaflet + OpenStreetMap（交互地图与底图）

项目不依赖 React，也不把 Notion 或其他第三方服务作为在线数据源。

## 仓库结构

```text
apps/
├── web/          Astro 网站、管理后台和 Web API
└── mcp/          Remote MCP Worker
packages/
└── core/         数据访问、校验、权限和共享业务逻辑
migrations/       D1 数据库迁移
scripts/          数据抓取、清洗和导入脚本
data/             导入模板与研究数据
docs/             架构、数据模型和部署文档
```

## 本地开发

需要 Node.js 24 和 npm。

```bash
git clone https://github.com/frip-fans/fripsi.de.git
cd fripsi.de
npm install

cp apps/web/.dev.vars.example apps/web/.dev.vars
cp apps/mcp/.dev.vars.example apps/mcp/.dev.vars

npm run db:migrate:local
npm run db:seed:local
npm run dev:web
```

默认情况下，网站运行在 `http://localhost:4321`，管理后台位于 `http://localhost:4321/admin`。本地示例配置通过 `DEV_AUTH_BYPASS` 提供测试身份；生产环境不得启用该选项。

如需调试 MCP Worker，可另开一个终端运行：

```bash
npm run dev:mcp
```

MCP endpoint 默认为 `http://localhost:8787/mcp`，健康检查位于 `/health`。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev:web` | 启动网站开发服务器 |
| `npm run dev:mcp` | 启动 MCP Worker 开发服务器 |
| `npm run typecheck` | 检查所有 workspace 和数据脚本的类型 |
| `npm test` | 运行测试 |
| `npm run build` | 构建全部 workspace |
| `npm run build:web` | 只构建网站 |
| `npm run visual:check` | 使用 Playwright 检查首页视觉状态 |
| `node scripts/visual-check-journey.mjs` | 检查 Journey 桌面端／移动端地图与播放交互 |
| `npm run db:migrate:local` | 将 migrations 应用到本地 D1 |
| `npm run db:seed:local` | 写入本地示例数据 |

## 数据维护

活动、歌曲、发行物和歌单均以 D1 为准。批量资料先整理成仓库约定的 CSV，再通过导入脚本生成或写入结构化数据。提交资料修正时，请同时提供可公开访问的来源链接。

- [歌单库的数据结构与导入格式](./docs/music-library.md)
- [数据库模型](./docs/data-model.md)
- [管理后台与 MCP](./docs/admin-and-mcp.md)

从 Notion 迁移旧活动数据时，可使用：

```bash
npm run import:notion -- data/raw/export.csv
npm run import:sql
```

原始导出文件放在被 Git 忽略的 `data/raw/`。执行导入前，请先检查生成的核验报告和 SQL。

## 部署

Web 与 MCP 是两个独立的 Cloudflare Worker，共用同一个 D1 数据库。仓库中的 `wrangler.jsonc` 保存 Worker、binding 和公开环境变量配置；令牌、Access 凭据等敏感值应使用 Cloudflare Secrets 或构建环境变量管理。

生产数据库迁移需要单独执行，不会随网站构建自动应用。部署流程和 Cloudflare Access 配置见 [部署文档](./docs/deployment.md)。

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
