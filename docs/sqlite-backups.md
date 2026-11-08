# OCI SQLite 数据库备份与恢复

本方案只备份 SQLite；图片、主机配置、应用密钥和 age 恢复私钥需要另外备份。数据库和密钥不得提交 Git，不得上传 GitHub Actions artifact。生产备份由主机 systemd 执行，独立于部署 runner 和 GitHub Actions。

## 组件与调度

`ops/sqlite-backup/sqlite_backup.py` 使用 Python SQLite Online Backup API 读取线上库，包括已提交的 WAL 内容。在一致性快照上执行完整 `integrity_check`、`foreign_key_check`、关键表计数和迁移记录查询，然后 gzip、age 公钥加密，计算密文和原始 SQLite 的 SHA-256。

生产机 timer 为 `04:00 Asia/Singapore`（前一天 UTC 20:00），`Persistent=true` 在错过任务后补跑。每次运行生成 UTC 时间戳加 UUID 的新对象，使用 S3 `If-None-Match: *` 防止覆盖；所有对象指定 Standard。远端密文上传后核对大小与元数据，最后上传 JSON 清单作为完成标记，再原子写入本地 `last-success.json`。未完成的远端密文不作为恢复点，等待 180 天生命周期清理。本地临时目录权限 0700，运行结束自动删除，包括失败时的明文；上传失败不改变旧成功记录。进程若被强杀，残留目录需由管理员检查后清理。

清单包含创建时间、完整应用提交 SHA、`d1_migrations` 全部已应用迁移、原始/gzip/密文大小、密文及原始库 SHA-256，以及 events、songs、releases、setlists、change_sets、audit_logs 记录数。现有 D1 迁移历史在 OCI 导入时应保留；缺失时备份失败，不能用猜测的迁移版本替代。

## R2 与密钥准备

1. 创建独立私有 R2 桶 `fripside-production-db-backups`，默认 Standard，关闭 r2.dev 和所有自定义公开域名，不绑定公开 Worker。
2. 在管理工作站使用桶管理凭据应用 `ops/sqlite-backup/lifecycle.json`，再读取验证规则。此管理凭据不放生产机：

   ```bash
   aws --endpoint-url "https://ACCOUNT_ID.r2.cloudflarestorage.com" s3api put-bucket-lifecycle-configuration \
     --bucket fripside-production-db-backups --lifecycle-configuration file://ops/sqlite-backup/lifecycle.json
   aws --endpoint-url "https://ACCOUNT_ID.r2.cloudflarestorage.com" s3api get-bucket-lifecycle-configuration \
     --bucket fripside-production-db-backups
   ```

   180 天到期异步删除，清单和密文使用同一前缀/规则。生命周期会替换整桶规则，仅用于这个新建专用桶，禁止对其他桶照抄执行。
3. 创建仅限该桶的 R2 Object Read & Write 凭据用于生产备份（Put、Head 需要；R2 预设权限粒度包含其他对象操作）。不要赋予 Admin 或其他桶访问权限。监控机单独使用该桶 Object Read Only 凭据。恢复使用独立的只读凭据。
4. 在生产机之外的个人工作站生成 age 密钥：

   ```bash
   umask 077
   age-keygen -o fripside-backup-recovery.agekey
   age-keygen -y fripside-backup-recovery.agekey
   ```

   私钥另存密码管理器/离线介质，仅将 `age1...` 公钥写入生产配置。私钥不进服务器、runner、Git 或 artifact。先保管私钥并完成恢复演练，再启用 timer。
5. 配置 HTTPS 通知 webhook，接受 JSON `title`、`body`（如 Bark POST endpoint）。测试收到通知，URL 本身按密钥保护。网络故障时通知也可能失败，因此必须在另一台主机运行远端监控，并以外部 uptime/heartbeat 监控该监控任务本身。

## 安装：先保持 timer 关闭

以下安装需在任务 PR 合并并验收后，由管理员执行；部署 runner 不具备修改这些 root 文件的权限。应用数据路径假设 `/var/lib/fripside/site.sqlite`；如 OCI 迁移实际路径不同，同时修改配置与 service 的 `ReadWritePaths`。

```bash
sudo apt-get install --yes python3-venv age
sudo install -d -m 0755 /opt/fripside-backup
sudo install -d -m 0700 /etc/fripside-backup /var/lib/fripside-backup
sudo python3 -m venv /opt/fripside-backup/venv
sudo /opt/fripside-backup/venv/bin/pip install -r ops/sqlite-backup/requirements.txt
sudo install -o root -g root -m 0644 ops/sqlite-backup/sqlite_backup.py /opt/fripside-backup/
sudo install -o root -g root -m 0600 ops/sqlite-backup/config.example.json /etc/fripside-backup/config.json
sudoedit /etc/fripside-backup/config.json
sudo install -o root -g root -m 0644 ops/sqlite-backup/fripside-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
systemd-analyze calendar '*-*-* 04:00:00 Asia/Singapore'
sudo systemd-analyze verify /etc/systemd/system/fripside-backup.{service,timer}
```

真实值不要写进 shell 参数或 shell history。配置 root:root 0600；父目录 0700。根用户服务用于兼容应用 owner-only 的 DB/WAL/SHM，配合 systemd 文件系统限制；配置只包含加密公钥。脚本和 venv root 所有，不安装在 runner 可写的 release 目录。`REVISION` 文件由部署产物提供完整 SHA；应用切换/迁移时避免恰好备份，备份清单仍以快照中的迁移历史为准。

手动触发与日志：

```bash
sudo systemctl start fripside-backup.service
sudo systemctl status fripside-backup.service
sudo journalctl -u fripside-backup.service --since today
```

直接脚本和 timer 使用同一文件锁，冲突会非零退出并通知。SDK 错误和 age stderr 不直接写日志，防止泄露凭据/URL。请按失败类型检查配置、网络、R2 权限、磁盘空间与迁移表；不要启用 boto3 debug 或 shell `set -x`。

## 远端监控与容量

在 staging 或独立监控主机安装同一脚本与依赖；`/etc/fripside-backup/monitor.json` 使用同一桶/前缀、单独只读凭据与通知 URL（其他路径字段 monitor 不使用）。安装 monitor service/timer。每小时查询远端最新已提交清单，检查密文存在及大小/哈希元数据；超过 24 小时无成功、桶总对象大小超过阈值或凭据无效都非零并通知。默认容量阈值 1 GiB，可根据增长调整。不会删除对象；清理由 R2 生命周期执行。

```bash
sudo install -o root -g root -m 0644 ops/sqlite-backup/fripside-backup-monitor.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start fripside-backup-monitor.service
# 验收完成后再启用：
sudo systemctl enable --now fripside-backup-monitor.timer
```

启用前检查账户其他桶的 Standard/IA 用量与账户账单告警，不能把 R2 免费额度全部留给备份。管理工作站运行 `wrangler r2 bucket list` 和每个桶的 `wrangler r2 bucket info NAME`，记录基线；账户级用量通过 Cloudflare R2 指标/账单持续观察。生产凭据不为了账户级监控而扩权。180 份约 1.1 MB 压缩快照约占 201 MB（未计密文/清单及增长）；监控以实际密文大小为准。列表请求为每小时每 1000 个对象一页，专用桶不放其他业务对象。

2026-11-08 只读查询基线：`cresendo` 0 对象/0 B；`frip-fan-media-prod` 与 `frip-fan-media-staging` 各 59 对象/34.3 MB，均 Standard，总计约 68.6 MB。这只是当时快照，需在启用前重新核对，并定期查看账户用量。

## 隔离恢复：显式选择备份

只在生产机之外、有离线恢复私钥的工作站/隔离主机执行。恢复配置同样 0600，包含只读桶凭据、生产数据库原路径（用于拒绝危险目标）及相同前缀。先列出清单，人工按时间、提交 SHA、迁移版本选择完整 key，不提供自动 `latest` 或覆盖线上库功能。

```bash
python3 ops/sqlite-backup/sqlite_backup.py --config /secure/restore.json restore \
  --manifest 'sqlite/production/EXACT_UTC_TIMESTAMP-UUID.sqlite.gz.age.json' \
  --identity /secure/fripside-backup-recovery.agekey \
  --isolation-root /tmp/fripside-restore-UNIQUE \
  --output /tmp/fripside-restore-UNIQUE/site.sqlite
```

恢复目录必须不存在，且位于生产数据库目录树之外。流程为下载密文 → 核对 SHA-256/大小 → age 解密 → gzip 解压 → 核对原库 SHA-256/大小 → 完整性/FK 检查 → 比较关键表计数和完整迁移历史。输出恢复清单，拒绝覆盖现有文件。

随后使用清单对应应用版本、隔离数据/图片目录、仅回环监听端口启动 OCI Node 应用；不要启用同步任务或生产写入口：

```bash
FRIP_DB_PATH=/tmp/fripside-restore-UNIQUE/site.sqlite \
FRIP_DATA_DIR=/tmp/fripside-restore-UNIQUE/data \
FRIP_MEDIA_DIR=/tmp/fripside-restore-UNIQUE/media \
APP_ENV=preview NODE_ENV=production HOST=127.0.0.1 PORT=4399 \
node apps/web/dist-node/server/entry.mjs
curl --fail http://127.0.0.1:4399/healthz
curl --fail http://127.0.0.1:4399/calendar
```

`dist-node` 来自 OCI 迁移分支；不能用现有 Workers 产物运行。确认应用能读取活动/歌曲，并记录状态、版本和计数。真正生产恢复是单独维护操作：停写、额外快照、检查版本兼容、人工切换文件和回滚计划；本脚本绝不自动执行。

## 验收与启用门槛

本地测试使用临时 SQLite WAL 写入线程、真实 age 加解密和模拟 S3，覆盖上传下载恢复、计数比对、唯一对象、锁冲突、上传/凭据/清单失败、密文篡改、过期和容量告警以及日志脱敏：

```bash
python3 -m venv /tmp/frip-backup-tests
/tmp/frip-backup-tests/bin/pip install -r ops/sqlite-backup/requirements-test.txt
PATH=/usr/bin:$PATH /tmp/frip-backup-tests/bin/python -m unittest discover -s ops/sqlite-backup -v
```

这些测试不能替代实际 R2 验收。生产 timer 启用前必须记录：

- 独立桶私有性、Standard、180 天生命周期和账户其他 R2 用量；受限凭据不能访问其他桶。
- 线上应用正常写入期间手动备份成功，日志与远端清单一致。
- 真实 R2 上传/下载、离线私钥解密、隔离恢复、计数匹配、对应版本应用读取成功。
- 错误 S3 endpoint/失效凭据非零退出，旧清单不变，收到通知；锁冲突和重复执行测试通过。
- 独立监控机真实通知投递、无备份超过一天和容量阈值告警测试通过。

全部通过后才执行 `sudo systemctl enable --now fripside-backup.timer`，核对 `systemctl list-timers fripside-backup.timer`。启用命令不放在应用部署 workflow 中。

2026-11-08 本地演练记录：生产导出副本通过模拟 S3 上传、下载、真实 age 解密和隔离恢复，关键表计数 events=546、songs=279、releases=64、setlists=166、change_sets=24、audit_logs=868 一致；SQLite 6,426,624 B，压缩加密后 1,116,530 B。OCI 迁移分支的隔离 Node 应用读取恢复库，`/healthz`、`/`、`/calendar`、`/music/songs` 均 HTTP 200。另有自动化 WAL 写入线程测试。尚未完成真实 R2、线上写入期间快照、真实通知和生产 timer 验收，不应据此启用 timer。

参考：[SQLite Online Backup API](https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup)、[age](https://github.com/FiloSottile/age)、[R2 生命周期](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)、[R2 S3 API](https://developers.cloudflare.com/r2/api/)、[systemd 时间格式](https://www.freedesktop.org/software/systemd/man/latest/systemd.time.html)。
