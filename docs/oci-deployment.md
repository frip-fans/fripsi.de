# OCI 自托管部署

应用从 Workers/D1 迁移至两台独立 OCI 主机，Cloudflare 保留 DNS/CDN、Access 与 Tunnel。生产为 `fripsi.de`，测试为 `staging.fripsi.de`，测试 MCP 为 `mcp-staging.fripsi.de/mcp`（仅开放 MCP/发现路径，由 Bearer 验证）。旧 Worker、D1 和 R2 媒体桶在切换验收期间保留，用于核对与回退；不自动删除原数据。

## 架构

- 运行时 Node 24：Astro standalone Web、内置 MCP、SQLite WAL 和本地封面目录。同步任务由独立 Node CLI/systemd timer 执行，与 Web 使用同一个本地 SQLite。
- `packages/node-runtime` 实现现有 D1/R2 接口的本地适配。D1 batch 对应不可交错的 SQLite 事务；外部连接写入会使公开页面缓存失效。公开 HTML/JSON 缓存 TTL 60 秒，最多 8 MiB/256 项，按 URL、语言与首页提示状态区分；后台、测试站、错误和携带 Set-Cookie/private/no-store 的响应不进入缓存。
- Web 只监听 `127.0.0.1:3000`，Tunnel 出站连接，指标只监听 `127.0.0.1:20241`。不为部署新增公网 SSH/应用端口；现有 SSH 保留管理员使用。
- 原生产 `/admin`、`/api/admin` Access 应用和策略保留。测试域名使用独立 Access 应用，复用既有测试站邮箱与地区限制；应用继续验证 JWT/AUD，强制关闭 staging 身份绕过。
- 数据在 `/var/lib/fripside/site.sqlite`，封面在 `/var/lib/fripside/media`。root:root 0600 的 `/etc/fripside/{web,sync}.env` 与应用版本分离。应用用户 `frip-app` 与 runner 用户 `frip-deploy` 分离，runner 无权直接读取数据库或配置。

## CI/CD

源码仍按任务 PR → staging → 验收源快照 release/* → rebase PR 到 master 发布，长期分支不强推。源码 CI 同时验证 Workers 回退构建和 OCI Node 构建。

私有部署仓库：`frip-fans/fripside-deploy`。自托管 runner 只注册到此仓库，标签分别为 `fripside-staging`、`fripside-production` 与 `deploy-only`。仓库不接收公共 PR 的自托管任务，不保存主机 SSH 私钥。

私有 `OCI deploy` 工作流可通过 Actions 页面或下列命令立即触发：

```bash
gh workflow run deploy.yml --repo frip-fans/fripside-deploy -f environment=staging
# 只有发布 PR 合并且源码 push CI 成功后，才部署生产：
gh workflow run deploy.yml --repo frip-fans/fripside-deploy -f environment=production
```

另有每半小时的受保护分支检查，避免跨仓库 PAT 或 GitHub App 密钥；GitHub cron 可能延迟，不保证精确触发时间。检查任务使用 GitHub 托管分钟数，仅在源 SHA 变化且源码 push CI 成功时构建。查询私有部署记录的 `payload.source_sha`，不能将私有部署仓库提交 SHA 当成应用 SHA。

托管 runner 检查源码分支、精确 SHA、成功的源码 push CI，再构建和生成代码产物。产物仅含 standalone 的 server/client、REVISION 与逐文件 SHA-256 清单，保留三天；禁止数据库、备份与配置密钥。机器上的 runner 下载同一工作流产物，验证归档哈希、来源 SHA、逐文件校验和与安全路径，拒绝链接和越界路径，原子切换 current 后仅 sudo 重启固定 Web 服务。

新版本 `/healthz` 必须在 30 秒内返回正确 SHA；失败时回到前一个代码目录并重启。此回退不回滚数据库。部署不执行 migration、不覆盖数据库、不启用同步或备份 timer。保留旧 release 以便回退，磁盘使用需管理员定期检查；不要清理当前或上一版本。

## 主机初始化与首次数据迁移

`ops/oci/bootstrap-host.sh` 是管理员脚本，不由 runner 执行。安装固定版本并验证 SHA-256，创建用户、目录和 2 GiB swap；保留现有 Caddy/防火墙。首次安装服务文件与 root 所有启动/安装脚本，准备环境文件，再注册私有仓库 runner。Tunnel Token 经受限文件和 systemd LoadCredential 传递，不放命令参数或仓库。

首次数据库通过 D1 导出导入独立 SQLite，执行完整性、FK、迁移记录与业务表计数核对。只允许向新环境的空路径导入；不能把测试库反向覆盖生产。封面通过临时只读 R2 凭据导出，逐个验证内容哈希，原 R2 对象保留。迁移数据只放在本机忽略目录或受限服务器目录，不经过 Git/Actions artifact。

生产切换前准备更新的生产快照、冻结旧写入、停止旧同步计划，核对最后数据与未完成同步任务。切换后旧 D1 只保留，不再作为写入目标；恢复旧平台前必须先处理新 SQLite 上已产生的写入，不能直接切回旧数据。

## 配置与同步

`web.env.example` 与 `sync.env.example` 只提供变量名。生产/测试 OpenAI Key、内部签名密钥和数据隔离。测试默认 `SYNC_ENABLED=false`、`BARK_ENABLED=false`。生产同步保持原模型、自动发布与软预算配置，API 密钥和 Bark Key 只存主机。停止旧 Worker cron 后才启用新 `fripside-sync.timer`，避免双写或重复调用模型；不为验收擅自启动付费模型任务。

Node CLI 复用现有同步代码、预算、数据库 lease 与通知状态；每五分钟 tick，和原 Worker 调度一致。可手动 `sudo systemctl start fripside-sync.service`。启动前必须核对 MCP HTTPS 地址、Access 策略及共享内部签名密钥。

## 验收与回退

- CI、独立目录启动、公开页面和手机日历/搜索路由；封面与静态资源、无横向溢出。
- Web 服务为非 root，监听回环；匿名后台/测试站拒绝，伪造 JWT 拒绝；MCP 匿名 401，元数据可读。
- 用隔离数据库测试实际提案发布、审计和缓存失效；线上不制造验收内容。
- 网站切换前保存旧 DNS、Worker 自定义域名/Builds 触发配置和 Access 对象。只切换 fripsi.de 相关对象，不改变其他域名或现有隧道。
- 旧 Workers 自动构建在切换后停用，避免后续 push 抢回路由。旧代码与 D1 仍保留；回退需先评估 SQLite 新写入和版本兼容。
- SQLite 备份按 [备份与恢复](sqlite-backups.md) 验收：真实 R2 上传下载、离线解密、隔离库和应用读取、失败/过期告警通过后才启用生产 timer。

日常查看：`systemctl status fripside-web fripside-tunnel`、`journalctl -u fripside-web`、私有部署 Actions/Deployments。日志不得打印配置内容、API Key、Tunnel Token 或恢复私钥。

## 迁移验收记录

2026-11-08：staging 已通过私有流水线部署 a99eab41e1e52b2c36451b949af385587ccc1a9f；原测试库 538 条活动、279 首歌曲、64 个发行物、166 个歌单、845 条审计记录及 59 张封面独立迁移。Web 域名匿名请求进入 Access；测试 MCP 发现返回正确资源 URL，匿名 MCP 401，MCP 域名后台路径 404。两个 OpenAI Key 仅通过无模型调用的认证检查，Bark 验证回执成功。

真实 R2 隔离演练期间正常后台 HTTP 完成 38 次写入，快照上传/下载/解密恢复后六张关键表计数一致，恢复后首页、日历和歌曲页均 200；失效凭据、锁冲突、容量和 25 小时过期检查非零并触发通知，重复备份生成独立对象。仅本次验收对象在结束后清理。恢复私钥仅保存在管理员本机配置目录，不上生产。

默认 `npm run deploy:web[:staging]` 已切换至私有部署流水线；旧 Workers 命令保留为显式 `deploy:web:workers:*:legacy`，仅用于人工回退。旧 sync 配置中的 cron 已移除，防止未来误部署重启旧 D1 写入。生产切换和首份生产备份状态以实际运维记录为准。

测试 MCP 子域名列入 Astro 的精确代理主机允许列表，保持 HTTPS Origin/Host 校验。切换验收后，旧 Web staging 与 MCP 的 workers.dev/preview 入口关闭，防止旧书签继续编辑 D1；原 Worker 版本和数据仍保留，可按单独维护流程恢复。旧 Builds 触发器改为仅匹配未使用的保留分支 `disabled-oci-migration-no-auto-build`，原配置保存用于回退。
