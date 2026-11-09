# 部署与运维

网站运行在两台独立的 OCI 主机上：生产 `https://fripsi.de`，测试 `https://staging.fripsi.de`。Cloudflare 只负责 DNS/CDN、Access 和 Tunnel。

| 入口 | 生产 | 测试 |
|---|---|---|
| 网站 | `https://fripsi.de` | `https://staging.fripsi.de`（整站 Access 保护） |
| 管理后台 | `https://fripsi.de/admin` | `https://staging.fripsi.de/admin` |
| Remote MCP | `https://fripsi.de/mcp` | `https://mcp-staging.fripsi.de/mcp`（只开放 MCP 与发现路径） |
| 健康检查 | `https://fripsi.de/healthz` | 主机内 `http://127.0.0.1:3000/healthz` |

## 架构

- **运行时**：Node 24 运行 Astro standalone 构建（`npm run build`，产物在 `apps/web/dist-node`，同步任务打包为其中的 `server/sync-cli.mjs`）。Web 进程同时提供 `/mcp`：`apps/web/src/lib/mcp-node.ts` 直接调用 `apps/mcp` 的处理函数。
- **数据**：SQLite（WAL）位于 `/var/lib/fripside/site.sqlite`，封面位于 `/var/lib/fripside/media`。`packages/node-runtime` 把业务代码使用的 D1/R2 接口适配到本地 SQLite 和文件目录；D1 batch 对应不可交错的 SQLite 事务。
- **缓存**：公开 HTML/JSON 在进程内缓存 60 秒（最多 8 MiB/256 项），按 URL、语言和首页提示状态区分；后台、测试站、错误响应以及带 Set-Cookie/private/no-store 的响应不缓存。外部连接写入会让公开缓存失效。
- **网络**：Web 只监听 `127.0.0.1:3000`，经 Cloudflare Tunnel 出站连接；指标只监听 `127.0.0.1:20241`。不为部署开放新的公网端口，现有 SSH 只给管理员使用。
- **用户隔离**：应用用户 `frip-app` 拥有数据库和媒体目录；runner 用户 `frip-deploy` 只能写 `/opt/fripside/releases`、重启 Web 服务和调用 migration 脚本，无法直接读取数据库或配置。`/etc/fripside/{web,sync}.env` 为 root:root 0600。
- **同步任务**：`apps/sync` 打包为 `server/sync-cli.mjs`，由 `fripside-sync.timer` 每五分钟运行一次（见下文「官方活动同步」）。

## CI/CD

源码按「任务 PR → staging → 验收源快照 release/* → rebase PR 到 master」发布，流程见 [发布流程](release-workflow.md)。

私有部署仓库 `frip-fans/fripside-deploy` 拥有部署专用 runner，标签为 `fripside-staging`、`fripside-production` 和 `deploy-only`；不接收公共 PR 的任务，不保存主机 SSH 私钥。部署工作流可以手动触发：

```bash
gh workflow run deploy.yml --repo frip-fans/fripside-deploy -f environment=staging
# 发布 PR 合并且 master 源码 CI 成功后：
gh workflow run deploy.yml --repo frip-fans/fripside-deploy -f environment=production -f apply_production_migrations=true
```

另有每半小时（`17,47 * * * *`）的受保护分支检查。GitHub cron 可能延迟；检查任务使用托管 runner 分钟数，只在源 SHA 变化且源码 push CI 成功时构建。应用版本以部署记录的 `payload.source_sha` 和 `/healthz` 为准，不要把私有部署仓库的提交 SHA 当作应用版本。

1. **构建**（托管 runner）：检出精确源 SHA，`npm run build:web:node`（`npm run build` 的别名，保留给部署工作流），用 `ops/oci/package-release.py` 打包 server/client、`migrations/*.sql`、REVISION 和逐文件 SHA-256 清单。产物保留三天，打包时拒绝数据库、密钥和配置文件。
2. **安装**（主机 runner）：`/usr/local/bin/fripside-install-release` 校验归档哈希、来源 SHA、逐文件校验和与安全路径，拒绝已被新提交取代的分支头。
3. **migration**：在切换代码前执行，规则见下文「Schema migration」。
4. **切换**：原子替换 `/opt/fripside/current` 后重启 `fripside-web.service`。新版本 `/healthz` 必须在 30 秒内返回正确 SHA，否则切回上一个代码目录。代码回退不回滚数据库。
5. 保留旧 release 以便回退；不要清理当前或上一个版本，磁盘用量由管理员定期检查。

## Schema migration

部署产物附带仓库的 `migrations/*.sql`。主机安装脚本在切换 current 之前调用 `/usr/local/bin/fripside-migrate`（源码 `ops/oci/migrate.py`，root 所有）：runner 通过唯一一条 sudoers 规则以数据库所有者 `frip-app` 身份运行它，runner 本身仍然无法读取数据库。

- 对比产物中的 migration 和 `d1_migrations`。数据库里有产物没有的记录、或待执行的 migration 比已执行的更早时，直接失败，不猜测版本。
- 只自动执行增量语句：`CREATE TABLE`、`CREATE [UNIQUE] INDEX`、`CREATE VIEW`、`ALTER TABLE … ADD COLUMN` 和 `PRAGMA foreign_keys = ON`。其他语句（`INSERT`/`UPDATE`/`DELETE`/`DROP`/改名/触发器等）让部署失败，退出码 4。`--allow-unsafe` 只供管理员 SSH 使用，runner 调用时会被拒绝。
- 执行前用 SQLite Online Backup 生成 `/var/lib/fripside/migration-backups/<UTC>-<sha>-before-<编号>.sqlite`（0600，完整性检查，保留最近 5 份），磁盘空间不足时不执行。
- 每个 migration 在 `BEGIN IMMEDIATE` 事务中执行，同时写入 `d1_migrations` 并检查外键；失败整体回滚，新代码不上线。
- staging 自动执行；production 默认只检查（退出码 3 表示有待执行的 migration，部署中止），需要手动触发部署并勾选 `apply_production_migrations`。

管理员手动执行非增量 migration（先确认快照和演练结果）：

```bash
sudo -u frip-app /usr/local/bin/fripside-migrate --release /opt/fripside/releases/<sha> --sha <sha> --mode apply --allow-unsafe
```

### 安装或升级主机脚本

主机脚本由管理员通过 SSH 以 root 安装，runner 不能修改。从已合并的源码提交取出 `ops/oci/install-release.py` 和 `ops/oci/migrate.py`（例如 `scp` 到主机的临时目录），在两台主机上分别执行：

```bash
sudo install -o root -g root -m 0755 ops/oci/install-release.py /usr/local/bin/fripside-install-release
sudo install -o root -g root -m 0755 ops/oci/migrate.py /usr/local/bin/fripside-migrate
printf '%s\n' \
  'frip-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart fripside-web.service' \
  'frip-deploy ALL=(frip-app) NOPASSWD: /usr/local/bin/fripside-migrate' | sudo tee /etc/sudoers.d/fripside-deploy >/dev/null
sudo chmod 0440 /etc/sudoers.d/fripside-deploy && sudo visudo -cf /etc/sudoers.d/fripside-deploy
sudo -u frip-deploy sudo -n -l   # 应列出上面两条规则
```

先升级两台主机的脚本，再合并私有部署仓库中带 `--migrate` 的 workflow；顺序反过来时，旧安装脚本不认识这个参数，部署会失败（不会上线新代码）。

## 主机初始化

`ops/oci/bootstrap-host.sh` 是管理员通过 SSH 以 root 运行的脚本，不由 runner 执行。它安装固定版本的 Node、cloudflared 和 Actions runner（均验证 SHA-256），创建用户、目录和 2 GiB swap，写入 sudoers 规则；保留现有 Caddy/防火墙。之后由管理员安装 `ops/oci/*.service`/`*.timer`、root 所有的启动/安装脚本和环境文件，再把 runner 注册到私有部署仓库。Tunnel Token 通过受限文件和 systemd `LoadCredential` 传递，不放进命令参数或仓库。

两套环境的数据库、凭据、runner 和 Tunnel 相互独立。不要把测试库覆盖到生产；测试库需要刷新时，只能把经授权的生产快照导入空路径，并核对完整性、外键、migration 记录和业务表计数。

## 环境配置

`ops/oci/web.env.example` 和 `ops/oci/sync.env.example` 只列出变量名，真实值只保存在主机的 `/etc/fripside/*.env`。

Web（`web.env`）：

| 变量 | 用途 |
|---|---|
| `APP_ENV` | `production` 或 `staging`；staging 整站要求 Access 并输出 `noindex` |
| `SITE_URL` | 公开站点 canonical URL |
| `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` | Cloudflare Access issuer 与后台应用 audience |
| `ADMIN_PUBLISHERS` | 逗号分隔的 publisher 邮箱 |
| `DEV_AUTH_BYPASS` | 必须为 `false`；非 development 环境会被强制关闭 |
| `MCP_RESOURCE_URL`、`MCP_AUTHORIZATION_SERVER`、`MCP_AUDIENCE` | MCP OAuth resource 配置 |
| `AUTOMATION_AUDIENCE`、`AUTOMATION_SIGNING_SECRET` | 自动同步任务凭据；签名密钥与 `sync.env` 相同，只存主机 |

数据库与媒体路径由 `fripside-web.service` 固定为 `FRIP_DB_PATH=/var/lib/fripside/site.sqlite`、`FRIP_MEDIA_DIR=/var/lib/fripside/media`。

### 管理后台 Access

在 Cloudflare Zero Trust 为 `fripsi.de/admin/*` 和 `fripsi.de/api/admin/*` 建立 self-hosted application；测试站使用独立的整站 Access 应用。外层 Access 策略和应用内 JWT/AUD 校验必须同时保留，缺少 AUD 时拒绝访问。

### MCP OAuth resource

Web 暴露 `GET /.well-known/oauth-protected-resource` 和 `POST /mcp`。测试 MCP 子域名列入 Astro 的精确代理主机允许列表，保持 HTTPS Origin/Host 校验。授权完成后至少用 MCP Inspector 或 Codex 验证 initialize、tools/list、只读查询和一次未发布提案，再授予 publish scope。

## 官方活动同步

`fripside-sync.timer` 每五分钟触发一次 `fripside-sync.service`（以 `frip-app` 运行 `sync-cli.mjs`，读取 `/etc/fripside/sync.env`）。`SYNC_ENABLED`、`SYNC_EVAL_ENABLED`、`BARK_ENABLED` 都为 `false` 时直接退出，不调用模型。测试站默认全部关闭；生产的 OpenAI Key 和 Bark Key 只存主机。手动运行一次：`sudo systemctl start fripside-sync.service`。启动前核对 `MCP_ENDPOINT_URL`、Access 策略和共享签名密钥。业务规则见 [官方活动自动同步](official-sync.md)。

“未发现新公告”只在确实读到官网后才记录：新闻页首页不可访问（`official_source_unavailable`）、读到但没有带日期的公告链接（`official_layout_changed`，如验证页或改版）、或本次候选正文全部读取失败（`official_articles_unreadable`）时，当天任务保持待重试，每次 tick 重新读取官网，连续 5 次失败后标记失败并通过 Bark 推送“官网读取失败”。部分页面失败不阻止当天任务，但会推送失败页面数。这些检查不调用 OpenAI；被官网拦截时改为人工核对，不绕过拦截。

## 日常运维

- 状态：`systemctl status fripside-web fripside-tunnel fripside-sync.timer`；日志：`journalctl -u fripside-web`、`journalctl -u fripside-sync`；部署记录看私有仓库的 Actions/Deployments。
- 数据库备份由主机 systemd timer 执行，独立于 GitHub Actions 和部署 runner，见 [SQLite 备份与恢复](sqlite-backups.md)。
- 日志可以包含 `request_id`、路由或工具名、actor ID、change set/活动 ID、耗时、结果和错误类别；不得包含配置内容、API Key、Tunnel Token、OAuth token、Access JWT、Cookie、完整 authorization header、恢复私钥或不必要的完整 AI prompt。

### 安全响应

**MCP OAuth 或凭据疑似泄漏**：立即撤销/轮换对应 token 或密钥；检查 MCP 和 audit log 中的异常调用；暂时移除 `events:publish`、`events:archive` scope；对可疑变更执行下线或恢复，必要时按 [SQLite 备份与恢复](sqlite-backups.md) 从快照恢复到隔离库核对。

**误发布**：在后台下线活动，不硬删除；审查 change set 和 audit log；创建并发布修正 change set，保留完整历史。

## 发布检查清单

- [ ] 公开查询不返回 draft、unpublished、archived 记录。
- [ ] `/admin`、`/api/admin` 未登录时被拦截，服务端验证 Access JWT；测试站整站拒绝匿名请求。
- [ ] canonical URL、404、robots 和 sitemap 正确；手机日历和无未来活动状态正常。
- [ ] `/mcp` 匿名请求返回 401，OAuth metadata、resource、audience 和 scopes 正确；写工具要求幂等键，publish/unpublish/archive 需要明确权限，不存在 SQL、任意 fetch 或硬删除工具。
- [ ] PR 已说明 migration 是否为增量；生产部署按需勾选 `apply_production_migrations`。
- [ ] 内容数据变更单独执行，并在执行前有快照。
