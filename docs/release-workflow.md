# 代码与数据发布流程

## 分支

```text
独立 worktree + 任务分支 → PR 到 staging → CI 通过 → 测试站验收 → staging 向 master 提 PR → 生产部署
```

`master` 是生产分支；`staging` 是长期测试分支。每个独立开发任务从最新 `origin/staging` 创建独立 worktree 和任务分支，同一任务的后续修正复用该 worktree。功能、修复、重构和文档变更均通过 PR 进入 `staging`，不直接推送 `staging` 或 `master`。

自动化开发代理遵循根目录 [AGENTS.md](../AGENTS.md)；Claude Code 通过 [CLAUDE.md](../CLAUDE.md) 的 `@AGENTS.md` 导入同一份规则。

## 开发与验收

1. 开始修改前获取最新 `origin/staging`，创建独立 worktree 和任务分支；不搬运其他任务的未提交改动。
2. 在任务 worktree 中开发并完成适用的验证。UI 预览必须来自该 worktree 的最新代码或构建，明确地址并实际确认改动可见。
3. 推送任务分支并提 PR 到 `staging`，说明变更、验证及数据库影响。等待 `CI / Verify` 通过，获得合并授权后再合并。
4. 在测试站完成验收。代码合并、CI 通过和测试站部署成功分别核对，不能互相替代。
5. 验收通过并获得发布授权后，从 `staging` 提 PR 到 `master`，通过检查后发布。

纯文档变更只需核对文案、链接、命令与 `git diff --check`，应用检查由 PR CI 执行。

将 `staging` 合并到 `master` 时使用 **merge commit**，不要 squash/rebase 这条长期分支，避免后续发布反复出现已经合并的提交。发布 PR 合并后不要删除 `staging`。若生产有紧急修复，要再把 `master` 合并回 `staging`。

## CI 与分支规则

GitHub Actions 的 `CI / Verify` 对 master/staging 的 push 与 PR 运行：安装锁定依赖、类型检查、测试、所有 workspace 构建，以及生产和 staging Web 构建。CI 不持有 Cloudflare 部署凭据。

master 规则要求 PR、`Verify` 检查成功、PR 分支与目标分支保持最新、所有讨论已解决；不强制他人批准，适合单人维护。master/staging 均禁止删除和强推。

项目协作规则要求 `staging` 也通过 PR 合入；即使仓库权限仍允许直接提交，也不能据此绕过该流程。`AGENTS.md` 和本文档不修改 GitHub 分支保护设置，仓库端的强制限制需单独配置。Cloudflare 发布前仍运行验证命令。

## Cloudflare Workers Builds

已于 2026-09-05 配置完成。两个现有 Worker 连接同一个 GitHub 仓库 `frip-fans/fripsi.de`，根目录均为 `/`，Node.js 24。

| 配置 | 测试 Worker | 生产 Worker |
|---|---|---|
| Worker | frip-fan-web-staging | frip-fan-web |
| Production branch | staging | master |
| Build command | `npm run typecheck && npm test` | `npm run typecheck && npm test` |
| Deploy command | `npm run deploy:web:staging` | `npm run deploy:web` |
| CLOUDFLARE_ENV | staging | production |
| 非生产分支构建 | 关闭 | 关闭 |

这里的 Production branch 是每个 Worker 自己的活动部署来源。测试 Worker 仍使用 staging 绑定。部署命令内包含构建，不要只运行默认 `npm run build:web` 后直接上传到生产。

`CLOUDFLARE_ENV` 在 Cloudflare 构建设置中也显式配置，避免框架环境选择和 Worker 名称检查不一致。使用 Cloudflare Builds 自己管理的部署 Token；服务器的 Wrangler OAuth 登录不应复制到 GitHub CI。

Cloudflare 构建与 GitHub CI 独立触发，因此 Cloudflare 的 Build command 也运行检查，以保证失败时不会执行部署。一次只向共享测试分支合并一项需要独立验收的改动；通过 Cloudflare 部署记录核对分支、提交 SHA 和活动版本。

## 数据库结构变更

新建顺序递增的 `migrations/*.sql`，不要修改已应用的 migration。

1. 本地验证 migration。
2. 对 staging 应用新增 migration，部署测试代码并验收。
3. 发布 PR 中写明生产 migration 和代码部署顺序。
4. 合并到 master 前，按兼容性要求先执行生产 migration；破坏性变更另行安排切换，不依赖普通自动部署。

```bash
# 在仓库根目录运行，只应用尚未执行的迁移
XDG_CONFIG_HOME="$PWD/.cache/xdg" npx wrangler d1 migrations apply frip-fan-staging --remote --env staging --config apps/web/wrangler.jsonc
XDG_CONFIG_HOME="$PWD/.cache/xdg" npx wrangler d1 migrations apply frip-fan-prod --remote --env production --config apps/web/wrangler.jsonc
```

当前自动部署不执行生产 migration。回滚 Worker 代码也不会撤销数据库 migration；执行前应确认恢复方案。

## 内容变更

活动、歌曲、发行物和歌单保存在 D1，合并 Git 分支不会发布这些数据。少量正式修正可在生产后台重做；批量变更应生成限定记录范围的变更包，核对生产最新值、处理冲突后单独执行。不要把测试库整体覆盖到生产库。测试过程中随意填写的数据不应发布。

跨环境内容发布功能尚未实现。测试库刷新是另一个独立操作，会覆盖测试内容，不能随 push 自动执行。
