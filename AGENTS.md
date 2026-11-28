# 项目协作约定

本文件是本仓库供 Codex、Claude Code 等开发代理共用的协作规则。详细发布流程见 [docs/release-workflow.md](docs/release-workflow.md)。

## Worktree 与分支

- 每个独立开发任务必须使用独立 worktree 和分支，包括新功能、修复、重构及文档变更。同一任务的后续修正复用原 worktree。
- 开始修改前检查当前分支、工作区状态，并获取最新 `origin/master`；新任务从最新 `origin/master` 创建分支。分支按用途使用 `feature/*`、`fix/*`、`docs/*` 等名称。
- 不在主工作区或 `master` 上直接开发，不混入其他任务的未提交改动。不要为切换任务而清理、覆盖或丢弃已有工作区内容。
- 在 Orca 环境中使用 `orca-cli` skill 创建和管理 worktree，先读取该环境的版本匹配操作指南。非 Orca 环境可使用标准 Git worktree。
- 新建 worktree 不代表需要启动其他 agent；是否委派按当前任务授权处理。
- 任务 PR 合并后清理对应 worktree 和本地任务分支，Orca 与非 Orca 环境均适用；Orca 中使用 `orca-cli` 删除，非 Orca 使用 `git worktree remove`。删除前检查未提交、未推送或未跟踪的内容（如本地数据、预览产物、笔记）；如有，先向用户说明，经用户确认可删除后再删除，不擅自丢弃或强制删除。

## PR 与发布

```text
独立 worktree + 任务分支 → PR 到 master → CI / 测试站验收 → 在已验收提交上打 v* tag → 生产部署
```

- `master` 是唯一的长期分支，也是测试站的来源：合并到 `master` 的提交在源码 CI 通过后部署到测试站。没有 `staging` 分支和 `release/*` 分支。
- 完成变更后推送任务分支，创建目标为 `master` 的 PR，说明最终行为、验证结果及数据库影响。
- 默认交付到可审查的 PR；只有已获得用户合并授权且检查通过，才合并到 `master`。已有授权无需重复询问。`master` 的保护规则只允许 **Rebase and merge**，保留 PR、Verify 和其他现有保护，不为合并改动或绕过保护规则。
- 不直接推送 `master`，不强推或删除 `master`，不通过手动部署绕过发布流程。
- 生产发布只通过 tag：测试站验收通过并获得发布授权后，在已验收的 master 提交上打 `vYYYY.MM.DD` tag 并推送（同一天再次发布加序号，如 `v2026.11.28.2`）。合并授权不等于发布授权；打 tag 就是发布到生产，没有发布授权不打 tag。
- 打 tag 前核对该提交：在 `master` 上、master push CI 成功、测试站部署成功且 `/healthz` 返回该 SHA。master 上比它更新的提交不会随这个 tag 发布。
- tag 不移动、不删除。回退时在要恢复的旧提交上打一个版本号更新的 tag；修复发布问题仍走独立 worktree 和 PR 流程。
- 代码合并不等于内容数据同步。内容导入和跨环境数据写入按发布文档单独处理，不随代码发布执行。
- Schema migration 优先写成增量变更（只加表、索引、视图或列）。测试站部署自动执行增量 migration；生产部署只在手动触发并勾选 `apply_production_migrations` 时执行；非增量 migration 由管理员按发布文档单独执行。PR 说明须写明 migration 是否为增量。

## 验证与预览

- 代码变更按影响范围运行类型检查、现有测试与构建。CI 的完整验证命令为：

  ```bash
  npm ci
  npm run typecheck
  npm test
  npm run build
  python3 -m unittest discover -s ops/oci
  ```

- 纯文档变更核对文案、相对链接、命令和 `git diff --check` 即可；不为此新增应用测试或重复构建。
- 开发或修正可在浏览器体验的功能时必须使用项目级 [dev-workflow skill](.agents/skills/dev-workflow/SKILL.md)，实际预览并走通受影响的交互，交付说明与最终页面一致。
- 如需本地测试数据，使用独立副本，不把其他任务或生产数据库作为可随意修改的测试数据源。
- 测试站验收使用 [Agent 测试身份](docs/staging.md#agent-测试身份)；凭据只从本机的私有文件读取，不写入仓库、PR、日志或对话。没有凭据时如实说明无法验收，不借用维护者的登录会话，也不绕过 Access。
- 区分本地检查、远端 CI 与部署状态。最终交付报告分支、PR 链接、实际验证结果及尚未完成的检查，不把“已推送”称为“已部署”。

## 界面文案与交互

- 除日历中的活动条目（event item）外，全站组件禁用圆角装饰条，包括两端圆弧或沿组件圆角弯折的强调线。允许使用直线边框、两端平直的页签选中线和普通组件边框。键盘焦点须清晰可见。
- 本站不添加装饰性的 slogan、口号、副标题或中英重复标签。界面文案须帮助用户理解内容或完成操作；不要为了填充版面添加英文小标题、重复主标题含义的说明等。必要的字段标签、分组名称与操作说明可以保留。
- 筛选、排序等浮层右上角放置明确的关闭按钮，不放装饰性标签。关闭按钮须有可访问名称、至少 44px 的触摸区域，支持键盘关闭并把焦点还给触发按钮。
- 返回链接说明实际目的地，保留进入前的月份、搜索、筛选与浏览位置；直接打开详情时使用明确的浏览入口文案，不假定用户存在上一步。
- 本地界面预览优先使用 live 数据库的一致性快照作为独立副本，并注明来源时间；预览不直连或写入 live 数据库。SQLite 快照仍遵循下述 WAL / Online Backup 约定，副本与备份不得提交 Git。

## 文档入口

- [发布流程](docs/release-workflow.md)：PR、环境构建、发布与 migration 顺序。
- [测试环境](docs/staging.md)：测试站地址、访问控制和部署触发方式。
- [架构](docs/architecture.md)：应用与共享业务逻辑边界。
- [留言系统](docs/comments.md)：访客留言、防滥用、审核与通知。

共享规则统一修改本文件；`CLAUDE.md` 只保留导入入口，发布文档与本文件保持一致。

## OCI SQLite 数据保护

- 数据库备份遵循 [SQLite 备份与恢复](docs/sqlite-backups.md)，生产 timer 独立于 GitHub Actions 和部署 runner。先完成脚本、配置模板、测试和真实隔离恢复验收，再启用生产 timer。
- 活跃 WAL 库只能通过 SQLite Online Backup API 或 `.backup` 生成快照，禁止直接复制主数据库文件。数据库、备份密文、R2 凭据及恢复私钥不得提交 Git 或上传 Actions artifact。
- 恢复必须显式指定备份，先验证隔离库和应用读取；不能自动覆盖线上库。生产机只保存 age 加密公钥，恢复私钥留在生产机之外。
- 测试库只通过 [用生产数据刷新测试库](docs/staging-refresh.md) 的脱敏导出刷新：使用测试机专属密钥和独立的桶，不读取正式备份，脚本拒绝在非 staging 主机上运行。新增数据表时同时在导出脚本中归类。

## OCI 部署

- 部署与发布按 [部署与运维](docs/oci-deployment.md) 执行；测试站跟随 master，生产跟随最新的 `v*` tag。
- 私有部署仓库拥有部署专用 runner；公共 PR 只运行 GitHub 托管 CI。私有工作流只部署 master 分支头（测试站）和最新 `v*` tag（生产）的精确 SHA，并要求该提交的 master push CI 成功；生产还要求该提交在测试站部署成功过。
- 主机 root 配置与应用/runner 用户隔离，部署产物只包含构建代码和 migration SQL，不包括数据库、备份或环境密钥。部署只按上述规则执行增量 migration（先快照），不覆盖数据库，不自动启用未验收 timer。
