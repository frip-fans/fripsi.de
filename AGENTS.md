# 项目协作约定

本文件是本仓库供 Codex、Claude Code 等开发代理共用的协作规则。详细发布流程见 [docs/release-workflow.md](docs/release-workflow.md)。

## Worktree 与分支

- 每个独立开发任务必须使用独立 worktree 和分支，包括新功能、修复、重构及文档变更。同一任务的后续修正复用原 worktree。
- 开始修改前检查当前分支、工作区状态，并获取最新 `origin/staging`；新任务从最新 `origin/staging` 创建分支。分支按用途使用 `feature/*`、`fix/*`、`docs/*` 等名称。
- 不在主工作区、`master` 或 `staging` 上直接开发，不混入其他任务的未提交改动。不要为切换任务而清理、覆盖或丢弃已有工作区内容。
- 在 Orca 环境中使用 `orca-cli` skill 创建和管理 worktree，先读取该环境的版本匹配操作指南。非 Orca 环境可使用标准 Git worktree。
- 新建 worktree 不代表需要启动其他 agent；是否委派按当前任务授权处理。

## PR 与发布

```text
独立 worktree + 任务分支 → PR 到 staging → CI / 测试站验收 → release/*（基于 master，内容对齐已验收 staging）→ rebase PR 到 master → 生产部署
```

- 完成变更后推送任务分支，创建目标为 `staging` 的 PR，说明最终行为、验证结果及数据库影响。
- 默认交付到可审查的 PR；只有已获得用户合并授权且检查通过，才合并到 `staging`。已有授权无需重复询问。
- 不直接推送 `staging` 或 `master`，不从普通功能分支直接向 `master` 发布，也不通过手动部署绕过分支发布流程。生产发布只使用下述 `release/*` 分支。
- `staging` 验收通过并获得发布授权后，固定验收提交 SHA；在独立 worktree 中从最新 `origin/master` 创建 `release/*` 分支，将已验收 staging 的完整受版本控制内容对齐到该分支，核对文件树完全一致，再提交发布 PR 到 `master`。不要将 staging 的合并历史直接带入发布分支。
- `master` 的现有保护规则只允许 **Rebase and merge**。发布 PR 使用 rebase 合并，保留 PR、Verify 和其他现有保护；不得为了发布改动或绕过保护规则。提交前和合并前核对发布分支 SHA、验收源 SHA、目标 master 与 CI 状态；master 或验收范围变化后重新准备发布分支并验证。
- 保留 `staging` 长期分支，不对 `staging` / `master` 本身做 rebase 或强推。rebase merge 会改变生产提交 SHA，发布后核对源代码文件树与生产部署提交，不要求两条长期分支具有相同提交历史。新的发布仍从最新 master 创建。
- 如 master 有尚未进入 staging 的生产修复，先通过独立任务 PR 回补 staging 并重新验收，避免发布快照覆盖生产修复。
- 不强推或删除 `staging`、`master`。修复发布问题仍走独立 worktree 和 PR 流程。
- 代码合并不等于内容数据同步。数据库 migration、内容导入和跨环境数据写入按发布文档单独处理，不随代码发布擅自执行。

## 验证与预览

- 代码变更按影响范围运行类型检查、现有测试与构建。CI 的完整验证命令为：

  ```bash
  npm ci
  npm run typecheck
  npm test
  npm run build
  npm run build:production --workspace @frip-fan/web
  npm run build:web:staging
  ```

- 纯文档变更核对文案、相对链接、命令和 `git diff --check` 即可；不为此新增应用测试或重复构建。
- UI 变更使用 Orca 内置浏览器验证；非 Orca 环境使用可用的浏览器工具。覆盖受影响的手机与桌面布局、键盘操作和语言版本。
- 预览必须对应当前任务 worktree 的最新代码或构建。明确告知用户预览地址；在声称改动可见前，实际检查页面内容，不能只确认服务器已启动。
- 如需本地测试数据，使用独立副本，不把其他任务或生产数据库作为可随意修改的测试数据源。
- 区分本地检查、远端 CI 与部署状态。最终交付报告分支、PR 链接、实际验证结果及尚未完成的检查，不把“已推送”称为“已部署”。

## 文档入口

- [发布流程](docs/release-workflow.md)：PR、环境构建、发布与 migration 顺序。
- [测试环境](docs/staging.md)：测试站地址、访问控制和自动部署。
- [架构](docs/architecture.md)：应用与共享业务逻辑边界。

共享规则统一修改本文件；`CLAUDE.md` 只保留导入入口，发布文档与本文件保持一致。
