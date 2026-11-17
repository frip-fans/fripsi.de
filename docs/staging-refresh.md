# 用生产数据刷新测试库

测试库可以整体替换为一份脱敏的生产快照。数据只走「生产机 → 私有 R2 桶 → 测试机」，不经过 GitHub：工作流只负责启动测试机上 root 所有的脚本并报告结果，数据库内容不进 Git、Actions artifact 或日志。

```text
生产机 timer ─ export ─> R2 fripside-staging-refresh（age 加密，7 天过期）
                                   │
部署仓库工作流 ─ sudo ─> 测试机 apply ─> 校验 → 迁移 → 停站替换 → 健康检查
```

## 使用

```bash
gh workflow run refresh-staging-db.yml --repo frip-fans/fripside-deploy -f confirm=staging
```

工作流应用最新一份已完成的导出。导出由生产机每天 04:30（Asia/Singapore）生成；超过 36 小时的导出会被拒绝。需要更新的数据时，管理员先在生产机手动导出一次，再触发工作流：

```bash
sudo systemctl start fripside-staging-refresh-export.service
```

刷新会丢弃测试库里的全部内容，包括测试中写入的活动、提案和后台聊天记录；刷新期间测试站停止服务约十几秒。被替换的库保留在 `/var/lib/fripside/refresh-previous/`（最近 2 份，0600）。成功后 `/var/lib/fripside/refresh-status.json` 记录刷新时间、快照时间、生产与测试的应用提交和关键表计数。

封面图片不随数据库刷新：生产新增的封面在测试站可能显示为缺图，需要另行同步 `/var/lib/fripside/media`。

## 导出（生产机）

`ops/sqlite-backup/staging_refresh.py export`：

1. 用 SQLite Online Backup API 生成一致性快照，不复制线上库文件，也不修改线上库。
2. 在快照副本上脱敏：
   - 清空后台聊天的会话和消息（`admin_chat_sessions`、`admin_chat_messages`），并清除提案上的会话关联（`change_sets.chat_session_id`）。
   - 清空留言封禁名单（`comment_blocks`），把所有留言的来源标识（`comments.source_hash`）改为固定值。
   - 其余数据保留，包括活动、音乐库、提案、审计日志（含管理员邮箱）和留言正文。
3. `VACUUM` 重建文件，删除的内容不会残留在空闲页里；再次核对脱敏结果，并做完整性和外键检查。
4. gzip 后用**测试机专属**的 age 公钥加密，上传到独立的 R2 桶，最后写入清单。没有清单的对象是未完成的导出，不会被应用。

每张表都必须在脚本里归类为“保留”或“清空”。遇到未归类的表时导出直接失败，CI 也会检查 `migrations/` 中的每张表都已归类：新增表的 migration 需要同时决定它能否进入测试站。

## 应用（测试机）

`ops/sqlite-backup/staging_refresh.py apply`，由 `/usr/local/bin/fripside-refresh-staging-db` 包装，不接受任何参数：

1. 确认本机是测试站：配置里 `environment` 为 `staging`，并且 `/etc/fripside/web.env` 中只有一条 `APP_ENV=staging`。任一不满足即拒绝，不会触碰数据库或服务。
2. 取得刷新锁和部署锁，与部署互斥。
3. 下载最新导出，核对密文和原库的大小与 SHA-256，解密，检查完整性、外键、表计数和迁移记录，并在测试机再次核对脱敏结果。
4. 在候选库上执行 `fripside-migrate --mode apply`，把它迁移到测试站当前版本的 schema。测试站有待执行的非增量 migration、或生产库有测试站版本没有的 migration 时，在这一步失败，线上库和服务不受影响。
5. 暂停同步 timer、停止 Web 服务，用 Online Backup 保存当前库，再用候选库替换，启动 Web 服务并等待 `/healthz`。
6. 健康检查失败时停站、放回保存的库、重新启动，并以失败退出。

## 密钥与权限

- 生产备份的恢复私钥仍然只在离线工作站。刷新导出使用另一对 age 密钥：私钥只在测试机（root 0600），公钥写入生产机的导出配置。测试机的私钥解不开 `fripside-production-db-backups` 中的正式备份。
- 独立 R2 桶 `fripside-staging-refresh`，私有、不绑定公开域名，7 天生命周期（`ops/sqlite-backup/lifecycle-staging-refresh.json`）。生产机使用只限该桶的 Object Read & Write 凭据，测试机使用只限该桶的 Object Read Only 凭据；两者都不能访问正式备份桶。
- 部署 runner 只多一条 sudoers 规则，只能不带参数地运行包装脚本。应用哪份导出、写到哪里都由 root 所有的配置决定；runner 仍然读不到数据库、私钥和配置。
- 生产机上不安装包装脚本和应用配置；即使误装，应用也会因为 `APP_ENV` 不是 `staging` 而拒绝。

## 安装

合并并验收后由管理员通过 SSH 以 root 执行，runner 不能修改这些文件。两台主机都需要已按 [SQLite 备份与恢复](sqlite-backups.md) 安装 `/opt/fripside-backup` 的 venv 和 `sqlite_backup.py`（测试机作为监控机时已具备）；`staging_refresh.py` 依赖同目录下更新后的 `sqlite_backup.py`，两个文件要一起安装。

先在测试机生成密钥：

```bash
sudo install -d -m 0700 /etc/fripside-refresh /var/lib/fripside-refresh
sudo sh -c 'umask 077 && age-keygen -o /etc/fripside-refresh/staging-refresh.agekey'
sudo age-keygen -y /etc/fripside-refresh/staging-refresh.agekey   # 输出 age1… 公钥，填入生产机配置
```

测试机：

```bash
sudo install -o root -g root -m 0644 ops/sqlite-backup/sqlite_backup.py ops/sqlite-backup/staging_refresh.py /opt/fripside-backup/
sudo install -o root -g root -m 0755 ops/sqlite-backup/fripside-refresh-staging-db /usr/local/bin/
sudo install -o root -g root -m 0600 ops/sqlite-backup/refresh-apply.example.json /etc/fripside-refresh/config.json
sudoedit /etc/fripside-refresh/config.json
printf '%s\n' 'frip-deploy ALL=(root) NOPASSWD: /usr/local/bin/fripside-refresh-staging-db ""' \
  | sudo tee /etc/sudoers.d/fripside-refresh >/dev/null
sudo chmod 0440 /etc/sudoers.d/fripside-refresh && sudo visudo -cf /etc/sudoers.d/fripside-refresh
```

生产机（timer 先不启用）：

```bash
sudo install -o root -g root -m 0644 ops/sqlite-backup/sqlite_backup.py ops/sqlite-backup/staging_refresh.py /opt/fripside-backup/
sudo install -o root -g root -m 0600 ops/sqlite-backup/refresh-export.example.json /etc/fripside-backup/refresh-export.json
sudoedit /etc/fripside-backup/refresh-export.json
sudo install -o root -g root -m 0644 ops/sqlite-backup/fripside-staging-refresh-export.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/fripside-staging-refresh-export.{service,timer}
```

在管理工作站为新桶应用生命周期并读取验证，方法同正式备份桶，文件换成 `ops/sqlite-backup/lifecycle-staging-refresh.json`。真实值不要写进 shell 参数或 history。

最后把 `ops/oci/deploy-control/refresh-staging-db.yml` 通过 PR 同步到私有部署仓库的 `.github/workflows/`。

## 验收与启用

1. 生产机手动导出一次：`sudo systemctl start fripside-staging-refresh-export.service`，日志只有一行 `exported`；确认桶里出现密文和清单，线上站点不受影响。
2. 在测试机直接运行 `sudo /usr/local/bin/fripside-refresh-staging-db`，确认输出 `refreshed`，测试站可访问，活动数量与清单一致，后台聊天记录为空。
3. 触发一次工作流，确认它以 runner 身份成功，且日志里没有数据库内容、密钥或配置值。
4. 把测试机配置里的 `environment` 临时改成别的值，确认脚本拒绝执行且测试站不受影响，再改回。
5. 全部通过后启用生产 timer：`sudo systemctl enable --now fripside-staging-refresh-export.timer`。

失败时脚本只输出自己的错误说明或异常类名，不输出 SDK 文本、凭据或 URL；导出失败会走备份配置里的通知 webhook。

本地测试使用真实 age 加解密和模拟 S3，覆盖脱敏、未归类表、替换与回滚、非测试环境拒绝、过期/伪造/未脱敏导出、迁移失败和与部署互斥，和备份脚本的测试一起运行，见 [SQLite 备份与恢复](sqlite-backups.md#验收与启用门槛)。这些测试不能替代上面的真实主机验收。
