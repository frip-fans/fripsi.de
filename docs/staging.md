# 测试环境

测试站 `https://staging.fripsi.de` 运行在独立的 OCI 主机上：独立的 SQLite、部署 runner、Tunnel 和 Access 应用。测试 MCP 为 `https://mcp-staging.fripsi.de/mcp`，只开放 MCP 与发现路径，由 Bearer 令牌验证。部署与主机配置见 [部署与运维](oci-deployment.md)。

## 访问控制

- 测试站整站由独立的 Cloudflare Access 应用保护，只允许测试管理员邮箱。
- 应用把 `APP_ENV=staging` 的所有 SSR 页面和 API 视为私有路由：验证 Access JWT、AUD 与 `ADMIN_PUBLISHERS`，并强制关闭开发身份绕过；缺少 AUD 时拒绝访问。
- 响应带 `X-Robots-Tag: noindex, nofollow`，不进入公开页面缓存；Giscus 评论组件不加载。

## 更新测试站

合并 PR 到 `staging` 不会立即更新测试站。私有部署仓库 `frip-fans/fripside-deploy` 的 `OCI deploy` 接受手动触发和每半小时的计划检查（`17,47 * * * *`），两者都要求 `staging` 的源码 push CI 已成功，并且只部署该分支当前 HEAD 的精确 SHA：

```bash
gh workflow run deploy.yml --repo frip-fans/fripside-deploy -f environment=staging
```

GitHub cron 可能延迟。是否更新成功以工作流结果和主机 `/healthz` 返回的 SHA 为准：PR 合并、CI 通过和测试站已更新要分别核对。

测试站部署会自动执行待执行的增量 migration（先生成快照）；非增量 migration 会让部署中止，由管理员处理，见 [发布流程](release-workflow.md#数据库结构变更)。

## 测试数据

- 测试库独立于生产库，不自动同步。刷新测试库需要经授权的生产快照，只能导入空路径，并核对完整性、外键、migration 记录和业务表计数；不要在已有测试内容的库上叠加完整快照，也不要把测试库覆盖到生产。
- 生产快照可能包含审计记录和邮箱，导出前需要明确授权；中间文件只放在被 Git 忽略的 `.cache/` 或受限服务器目录。
- 测试中写入的内容只留在测试库，不会随代码合并进入生产。
- 测试站默认 `SYNC_ENABLED=false`、`BARK_ENABLED=false`，不调用模型；需要试跑自动同步时按 [官方活动自动同步](official-sync.md) 单独开启并在结束后关闭。
