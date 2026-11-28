# 代码与数据发布流程

## 分支

```text
独立 worktree + 任务分支 → PR 到 master → CI / 测试站验收 → 在已验收提交上打 v* tag → 生产部署
```

`master` 是唯一的长期分支，对应测试站；生产运行的是最新 `v*` tag 指向的 master 提交。每个独立开发任务从最新 `origin/master` 创建独立 worktree 和任务分支，同一任务的后续修正复用该 worktree。功能、修复、重构和文档变更均通过 PR 进入 `master`，不直接推送 `master`。

自动化开发代理遵循根目录 [AGENTS.md](../AGENTS.md)；Claude Code 通过 [CLAUDE.md](../CLAUDE.md) 的 `@AGENTS.md` 导入同一份规则。

## 开发与验收

1. 开始修改前获取最新 `origin/master`，创建独立 worktree 和任务分支；不搬运其他任务的未提交改动。
2. 在任务 worktree 中开发并完成适用的验证。UI 预览必须来自该 worktree 的最新代码或构建，明确地址并实际确认改动可见。
3. 推送任务分支并提 PR 到 `master`，说明变更、验证及数据库影响。等待 `CI / Verify` 通过，获得合并授权后用 **Rebase and merge** 合并。
4. master 的 push CI 通过后测试站自动部署（或手动触发），在测试站完成验收。代码合并、CI 通过和测试站部署成功分别核对，不能互相替代。
5. 验收通过并获得发布授权后，按下一节打 tag 发布到生产。
6. 任务 PR 合并后，清理对应 worktree 和本地任务分支（Orca 与非 Orca 环境均适用）。删除前检查未提交、未推送或未跟踪的内容；如有，先向用户说明，经确认可删除后再删除。

纯文档变更只需核对文案、链接、命令与 `git diff --check`，应用检查由 PR CI 执行。

## 生产发布

生产只部署版本号最新的 `v*` tag。tag 名为 `v` 加点号分隔的数字，按数值比较；约定使用日期 `vYYYY.MM.DD`，同一天再次发布加序号（`v2026.11.28.2`）。其他名字的 tag 不触发部署。

部署工作流只接受满足下列条件的 tag，否则跳过并在日志中说明原因：

- 指向的提交在 `master` 上；
- 该提交有成功的 master push CI。一个 PR 含多个提交时，只有 rebase 合并后的最后一个提交有 push CI，tag 打在它上面；
- 该提交在测试站部署成功过（最近 100 次测试站部署内）。

```bash
git fetch origin master --tags
release_sha="$(git rev-parse origin/master)"   # 或更早的已验收提交
# 核对 release_sha 就是测试站 /healthz 返回并完成验收的版本
git log --oneline "$(git describe --tags --abbrev=0 --match 'v*' "$release_sha")..$release_sha"
git tag -a v2026.11.28 "$release_sha" -m "Release <本次内容>"
git push origin v2026.11.28
gh workflow run deploy.yml --repo frip-fans/fripside-deploy -f environment=production
```

`git log` 一行列出上一个 tag 之后将要发布的提交，核对它们都已验收。master 上比 tag 更新的提交不会发布。推送 tag 后可以手动触发部署，也可以等每半小时的计划检查；发布后确认生产部署记录和 `https://fripsi.de/healthz` 返回的版本。

tag 不移动、不删除（仓库规则禁止）。回退到旧版本时，在那个提交上打一个版本号更新的 tag；代码回退不回滚数据库，增量 migration 保留。只想发布 master 上的一部分改动时，tag 打在包含它们的最后一个已验收提交上；如果未验收的改动排在前面，先用 PR revert 它，验收后再发布。

## CI 与分支规则

GitHub Actions 的 `CI / Verify` 对 master 的 push 与 PR 运行：安装锁定依赖、类型检查、测试、Node standalone 构建（`npm run build`）与 `ops/oci` 打包/migration/部署探测测试，另有 SQLite 备份脚本测试。CI 不持有部署凭据；构建和部署由私有部署仓库完成，见下文「部署」。

master 规则要求 PR、`Verify` 检查成功、PR 分支与目标分支保持最新、所有讨论已解决，并且仅允许 rebase 合并；不强制他人批准，适合单人维护。master 禁止删除和强推，`v*` tag 禁止删除和改写。

## 部署

私有仓库 `frip-fans/fripside-deploy` 的 `OCI deploy` 工作流负责构建和部署：测试站部署 `master` 分支头，生产部署最新 `v*` tag，都只部署精确 SHA，并要求该 SHA 的 master push CI 已成功。手动触发或等待每半小时的计划检查：

```bash
gh workflow run deploy.yml --repo frip-fans/fripside-deploy -f environment=staging
gh workflow run deploy.yml --repo frip-fans/fripside-deploy -f environment=production -f apply_production_migrations=true
```

只有在测试站部署过的提交才能发布，连续合并多个 PR 时中间的提交可能没有单独部署过。需要独立验收的改动，等上一项在测试站部署并验收后再合并下一项；用部署记录的 `payload.source_sha` 和 `/healthz` 核对线上版本。构建、主机安装与回退细节见 [部署与运维](oci-deployment.md)。

## 数据库结构变更

新建顺序递增的 `migrations/*.sql`，不要修改已应用的 migration。优先写成**增量 migration**：只新建表、索引、视图或给表加列，旧代码在新结构上照常运行。需要改数据、删列或改名时，拆成「先增量、后清理」两步。

部署流程按下面的规则执行 migration（实现见 `ops/oci/migrate.py`，细节见 [部署与运维](oci-deployment.md#schema-migration)）：

| 环境 | 增量 migration | 其他 migration |
|---|---|---|
| staging | 部署时自动执行 | 部署中止，由管理员通过 SSH 执行 |
| production | 只检查；有待执行的 migration 时部署中止。用 `apply_production_migrations=true` 手动触发部署才执行 | 同上 |

每次执行前都会先生成本机 SQLite 快照（保留最近 5 份），然后逐个在事务中执行并写入 `d1_migrations`；任何一步失败都会整体回滚，新代码不会上线。代码健康检查失败时只回退代码，增量 migration 保留，因为旧代码兼容。

1. 本地验证 migration，PR 说明里写清楚是否为增量 migration。
2. 合并到 master 后，测试站部署自动执行增量 migration；在测试站验收。
3. 推送发布 tag 后手动触发生产部署，不等计划检查（计划检查只检查 migration，有待执行项时部署中止）：

   ```bash
   gh workflow run deploy.yml --repo frip-fans/fripside-deploy -f environment=production -f apply_production_migrations=true
   ```

4. 非增量 migration（如 `0004_structured_locations.sql`、`0006_journey_coordinate_data.sql` 这类改数据或删结构的变更）另行安排：先备份并在副本上演练，再由管理员在主机上执行，最后部署代码。

## 内容变更

活动、歌曲、发行物和歌单保存在各环境自己的 SQLite 数据库中，合并 Git 分支不会发布这些数据。少量正式修正可在生产后台重做；批量变更应生成限定记录范围的变更包（只更新指定记录、先试运行、执行前快照），核对生产最新值、处理冲突后，由管理员在主机上以 `frip-app` 身份单独执行。不要把测试库整体覆盖到生产库。测试过程中随意填写的数据不应发布。

跨环境内容发布功能尚未实现。测试库刷新是另一个独立操作，会覆盖测试内容，不能随 push 自动执行。

## 数据库备份

主机 systemd timer 定时备份数据库，独立于 GitHub Actions 和部署 runner；部署不会覆盖数据库或启用未验收的备份任务。备份只覆盖数据库，图片、配置和密钥另行安排。见 [SQLite 备份与恢复](sqlite-backups.md)。
