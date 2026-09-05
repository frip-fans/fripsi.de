# Cloudflare staging

测试站地址：`https://frip-fan-web-staging.rklee.workers.dev`。

- Worker：`frip-fan-web-staging`
- D1：`frip-fan-staging`（`32c5a88c-bbd1-4bda-9814-b8cce16fc7c4`）
- 配置：`apps/web/wrangler.jsonc` 中的 `env.staging`
- 运行时：`APP_ENV=staging`

## 登录保护

在 Cloudflare Zero Trust 创建独立的 Self-hosted Access 应用，保护该 Worker 的全部流量（可从 Workers → frip-fan-web-staging → Access → Protect this Worker behind Access，选择 All traffic）。范围应覆盖此测试 Worker 的固定 workers.dev 入口。Allow 策略只包含测试管理员邮箱。把该应用的 AUD 写入 `env.staging.vars.ACCESS_AUD`，并确保 `ACCESS_TEAM_DOMAIN` 与该应用所在的 Zero Trust 团队一致。

`ADMIN_PUBLISHERS` 是测试站允许访问和编辑的邮箱列表。所有 SSR 页面/API 均验证 Access JWT 和邮箱，强制关闭开发身份绕过；缺少 AUD 时拒绝访问。静态资源由 Cloudflare 提供，因此完整站点保护仍需要边缘 Access 应用。固定 `workers.dev` 入口启用，Preview URLs 关闭；自定义测试域名不再绑定。

测试站响应包含 `X-Robots-Tag: noindex, nofollow`，SSR 响应不缓存；Giscus 正式评论组件不加载。

## 部署

在仓库根目录运行：

```bash
npm run typecheck
npm test
npm run deploy:web:staging
```

此命令先通过 `CLOUDFLARE_ENV=staging` 构建，再通过 `wrangler deploy` 更新独立测试 Worker 的活动版本。这是测试 Worker 自己的 production deployment；Wrangler 配置仍选择 staging，以保持测试库和生产库隔离。不要直接复用生产构建产物。`npm run deploy:web` 仍然部署生产环境。

Wrangler 登录状态位于 `.cache/xdg`：

```bash
XDG_CONFIG_HOME="$PWD/.cache/xdg" npx wrangler login --device --browser=false
```

## 数据初始化与更新

测试库是独立数据库，不自动同步生产。完整生产快照可能包含审计记录和邮箱；导出到服务器前需要明确授权，导出期间 D1 会阻塞其他数据库查询。

初次部署应把授权的生产 SQL 快照导入空的测试库，核对业务表记录数、迁移记录及外键完整性。若之后代码增加 migration，只向测试库应用新增 migration。不要在已有测试内容的库中直接叠加完整快照，也不要将测试库反向覆盖到生产。

导出和验证中间文件保存于被 Git 忽略的 `.cache/staging/`。

MCP staging 和 Git 分支自动部署尚未配置；当前命令部署服务器工作区中的 Web 代码。

## 2026-09-05 初始化记录

已获授权，将生产完整 SQL 快照导入独立测试库。25 张表记录数与快照一致，外键检查无违规；包含 534 个活动、279 首歌曲、64 个发行物、166 份歌单及 6 条迁移记录。生产数据库未被写入。
