# 代码与数据发布流程

## 分支

```text
feature/* → PR 到 staging → 测试站验收 → staging 向 master 提 PR → 生产部署
```

`master` 是生产分支；`staging` 是长期测试分支。功能分支从最新 `staging` 创建。直接推送 `staging` 也可以，但应优先使用 PR，让 CI 在进入测试分支前运行。

将 `staging` 合并到 `master` 时使用 **merge commit**，不要 squash/rebase 这条长期分支，避免后续发布反复出现已经合并的提交。发布 PR 合并后不要删除 `staging`。若生产有紧急修复，要再把 `master` 合并回 `staging`。

## CI 与分支规则

GitHub Actions 的 `CI / Verify` 对 master/staging 的 push 与 PR 运行：安装锁定依赖、类型检查、测试、所有 workspace 构建，以及生产和 staging Web 构建。CI 不持有 Cloudflare 部署凭据。

master 规则要求 PR、`Verify` 检查成功、PR 分支与目标分支保持最新、所有讨论已解决；不强制他人批准，适合单人维护。master/staging 均禁止删除和强推。staging 允许直接提交，Cloudflare 发布前仍应运行验证命令。

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
