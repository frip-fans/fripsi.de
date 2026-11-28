# 测试环境

测试站 `https://staging.fripsi.de` 运行在独立的 OCI 主机上：独立的 SQLite、部署 runner、Tunnel 和 Access 应用。测试 MCP 为 `https://mcp-staging.fripsi.de/mcp`，只开放 MCP 与发现路径，由 Bearer 令牌验证。部署与主机配置见 [部署与运维](oci-deployment.md)。

## 访问控制

- 测试站整站由独立的 Cloudflare Access 应用保护，只允许测试管理员邮箱。
- 应用把 `APP_ENV=staging` 的所有 SSR 页面和 API 视为私有路由：验证 Access JWT、AUD 与 `ADMIN_PUBLISHERS`，并强制关闭开发身份绕过；缺少 AUD 时拒绝访问。
- 响应带 `X-Robots-Tag: noindex, nofollow`，不进入公开页面缓存；留言功能可用，数据写入测试库，与生产互不相通（见[留言系统](comments.md)）。

## Agent 测试身份

开发代理验收测试站时不使用维护者的登录会话，而是使用一个专用的 Cloudflare Access 服务令牌。应用只在 `APP_ENV=staging` 时认这个身份，生产环境设置同名变量不起任何作用。

- 身份：`agent:<服务令牌 Client ID>`，类型为 AI，拥有测试站上 publisher 的全部权限，可以保存和发布；它的操作在测试库的审计日志里按这个 ID 记录。
- 范围：`https://staging.fripsi.de` 的页面、后台、`/api/admin/*` 和 `/mcp`。`mcp-staging.fripsi.de` 仍然只接受 OAuth Bearer 令牌。
- 带邮箱的 Access 登录永远按人处理；未列入名单的服务令牌和以前一样，进不了测试站。

配置（管理员执行一次）：

1. 在 Cloudflare Zero Trust 的 Access → Service Auth 创建服务令牌，记下 Client ID 和 Client Secret。Secret 只显示一次。
2. 在测试站的 Access 应用上增加一条 Action 为 **Service Auth** 的策略，Include 选择该服务令牌。不要把它加到生产的 Access 应用上。
3. 在测试机 `/etc/fripside/web.env` 加上 `STAGING_SERVICE_CLIENTS=<Client ID>`（多个用逗号分隔），重启 `fripside-web.service`。
4. 把 Client ID 和 Secret 保存在运行代理的机器上，例如 `~/.config/fripside/staging-agent.env`（0600），不提交 Git，不写进对话、PR 或日志：

   ```bash
   FRIP_STAGING_ACCESS_CLIENT_ID=xxxxxxxx.access
   FRIP_STAGING_ACCESS_CLIENT_SECRET=...
   ```

同一令牌轮换 Secret 后，在运行 agent 的机器上用本地编辑器更新上述文件中的 `FRIP_STAGING_ACCESS_CLIENT_SECRET`。如更换 Client ID，同时更新本地 ID、引用旧令牌的 Access 策略和测试机的 `STAGING_SERVICE_CLIENTS`，并重启测试机应用。发生泄露时还须立即使旧 Secret 失效、撤销已有会话并检查 Access 与 staging 的审计记录。

### Agent 验收入口

在仓库根目录运行。浏览器检查用项目锁定的 Playwright 和 Chromium；首次可用 `npm ci` 和 `npx playwright install chromium` 准备环境。

```bash
python3 -I ops/staging-check/check.py
python3 -I ops/staging-check/check.py '/music/tours?lang=zh-CN' 'main h1'
```

第一条校验健康响应。第二条在 Linux / WSL 的一次性无头浏览器中打开指定 staging 路径并断言元素可见。凭据文件使用上面的简单 `KEY=value` 格式，权限须为 0600。工具直接读取文件，请勿提前 source、导出 Secret 或用 Playwright 请求头传递令牌。认证仅请求固定主机，不跟随重定向。若 Access 不签发会话 cookie，浏览器检查会报告无法执行。

浏览器通过匿名管道接收短期 cookie，用 `/dev/shm` 暂存一次性配置。工具仅报告预定义结果，丢弃浏览器进程树的标准输出和错误输出。需要验证进一步交互时，沿用此隔离入口增加针对页面的断言；不要为调试开启请求转储、trace、HAR、持久化登录状态或输出原始异常。可见性检查只证明给定元素可见，交互验收应报告实际操作的流程。

## 更新测试站

测试站运行 `master` 分支头。合并 PR 到 `master` 不会立即更新测试站。私有部署仓库 `frip-fans/fripside-deploy` 的 `OCI deploy` 接受手动触发和每半小时的计划检查（`17,47 * * * *`），两者都要求 `master` 的源码 push CI 已成功，并且只部署该分支当前 HEAD 的精确 SHA：

```bash
gh workflow run deploy.yml --repo frip-fans/fripside-deploy -f environment=staging
```

GitHub cron 可能延迟。是否更新成功以工作流结果和主机 `/healthz` 返回的 SHA 为准：PR 合并、CI 通过和测试站已更新要分别核对。

测试站部署会自动执行待执行的增量 migration（先生成快照）；非增量 migration 会让部署中止，由管理员处理，见 [发布流程](release-workflow.md#数据库结构变更)。

## 测试数据

- 测试库独立于生产库，不自动同步。需要生产数据时按 [用生产数据刷新测试库](staging-refresh.md) 整体替换为脱敏快照：脚本核对完整性、外键、migration 记录和业务表计数，替换前保存原库。不要手工在已有测试内容的库上叠加快照，也不要把测试库覆盖到生产。
- 生产快照可能包含审计记录和邮箱，导出前需要明确授权；中间文件只放在被 Git 忽略的 `.cache/` 或受限服务器目录。
- 测试中写入的内容只留在测试库，不会随代码合并进入生产。
- 测试站默认 `SYNC_ENABLED=false`、`BARK_ENABLED=false`，不调用模型；需要试跑自动同步时按 [官方活动自动同步](official-sync.md) 单独开启并在结束后关闭。
