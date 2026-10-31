# 官方活动自动同步

`apps/sync` 每天启动 OpenAI Agents API 任务。Agent 在 OpenAI 端交替使用官方网页搜索和本站 Remote MCP，自行查询已有活动、提案、预览并发布。`apps/mcp` 在 Cloudflare 执行工具，通过共享 `ChangeService` 写入同一个 D1。活动更新不需要重建网站。

## 运行流程

```text
Cloudflare Cron → 官方公告正文哈希比较 → 有变化才启动 OpenAI Agent
                  ├─ web_search：阅读 fripside.net 官方公告
                  ├─ events.search / get / check_duplicate：通过 MCP 查询当前数据
                  ├─ sources.read → sync.propose：提交来源版本和证据段落ID
                  ├─ changes.preview：取得预览及 preview_digest
                  └─ changes.publish_automatic：直接发布已授权变更
```

每个日本日历日最多建立一个常规任务。先读取最近 60 天公告目录（最多 4 页）与未来活动的官网来源，优先读取未发现的公告，再按最早刷新时间轮转；每轮最多刷新 24 篇正文、向模型提交 16 篇有变化的公告，比较正文哈希；没有新增或正文变化时不调用模型。五分钟 Cron 用来收取未完成任务，当天结束后不再调用模型。单个任务仍可能包含多轮推理、搜索和 MCP 调用，按实际用量计费。`OPENAI_MODEL` 当前默认 `gpt-6-luna`，先在测试站核对效果；遇到证据冲突、关键日期/会场/状态变更、遗漏公告或模型请求复核时，自动交给 `gpt-6.1-sol` 复核一次；复核仍可自主发布，只有官方资料不足才留下待处理事项。

不再预先把整份活动库交给模型。Agent 按需查 MCP，获取实时 ID、来源和版本。调度器保存固定任务输入与 session ID，失败重试使用同一幂等键；最多重试五次，超过一小时取消并结束。任务可能在最终报告前已发布部分内容，失败不会自动撤销已发布记录。不得通过创建新任务重试整批写入。

## 两类 MCP 身份与发布规则

普通用户仍使用原来的 Access/OAuth 身份，`changes.publish` 要求逐次人工确认。

每日 Agent 使用专用自动化身份：

- sync 为当天 run 签发有效期一小时的 HS256 JWT，身份固定为 `official-sync-agent`，audience 精确匹配目标 MCP 地址。
- MCP 检查签名、有效期、run 是否仍活跃及 run 的 `auto_publish` 授权。
- 自动身份只暴露活动查询、`sync.propose`、预览，以及获授权时的自动发布工具；不能调用普通发布、下线或归档工具。
- 只能发布关联到当前 run 的提案；同一任务最多处理 20 条变更。必须带服务端预览返回的摘要，记录变化后需重新预览。
- 无需逐条人工确认，但来源、重复检测、乐观锁、幂等及审计继续由服务端执行。

同步只维护活动日历，不自动维护歌曲、专辑曲目、歌单，也不修改未公开活动或公开路径。日期不明不创建活动；参数、证据、版本错误先自动修正两轮，仍不确定则自动请求 Sol 复核。重复事项不重复创建；真正缺证据的提案保留在 `/admin/changes`。

MCP 的 `sources.read` 独立读取官网正文，为每段生成 ID，并返回正文版本哈希。提案引用段落 ID，避免模型拼接不连续引文；发布前刷新正文核对版本、日期、开始时间、场馆和状态。只读取公开正文，不读取会员内容。限制响应大小和重定向域名；staging 首次试跑已验证 Worker 可访问官网。模型仍可能遗漏或出错。

## 配置放哪里

这些是 **Cloudflare Worker 运行时配置**，不是 GitHub CI Secrets，也不是 Cloudflare Builds 的构建变量。GitHub CI 仅测试和构建，不调用真实 OpenAI。

Cloudflare 控制台：**Workers & Pages → 选择对应 Worker → Settings → Variables and Secrets → Add**。敏感项选择 **Secret**。

| 名称 | 类型 | 配置在哪个 Worker | 内容 |
|---|---|---|---|
| `OPENAI_API_KEY` | Secret | sync | OpenAI 项目 API key |
| `AUTOMATION_SIGNING_SECRET` | Secret | sync 和 MCP | 同一环境两边填写同一个随机密钥，至少 32 字节 |
| `MCP_ENDPOINT_URL` | 普通变量 | sync | 实际 MCP 完整 HTTPS 地址，以 `/mcp` 结尾 |
| `AUTOMATION_AUDIENCE` | 普通变量 | MCP | 必须与 `MCP_ENDPOINT_URL` 完全相同 |
| `MCP_RESOURCE_URL` | 普通变量 | MCP | MCP 的实际 origin，不包含 `/mcp` |
| `OPENAI_MODEL` | 普通变量 | sync | 常规任务模型，默认 `gpt-6-luna` |
| `OPENAI_REVIEW_MODEL` | 普通变量 | sync | 自动复核模型，默认 `gpt-6.1-sol` |
| `SYNC_DISCOVERY_ENABLED` | 普通变量 | sync | 默认 `true`，正文未变时跳过模型 |
| `SYNC_BUDGET_USD` | 普通变量 | sync | 预算组软上限，默认 1 美元；不是每日预期花费 |
| `SYNC_BUDGET_GROUP` | 普通变量 | sync | 默认按日本日期分组；验收时可指定共享测试组 |
| `SYNC_EVAL_ENABLED` | 普通变量 | sync | 默认 `false`；开启后优先运行已排队的固定样例评测 |
| `SYNC_ENABLED` | 普通变量 | sync | `true` 启用调度，默认 `false` |
| `SYNC_AUTO_PUBLISH` | 普通变量 | sync | `true` 授权当日任务直接发布，`false` 只生成提案 |

OpenAI key 从 [OpenAI Platform](https://platform.openai.com/api-keys) 创建，需具备 `api.agents.read`、`api.agents.write`、`api.responses.write`。OpenAI key 只给 sync；共享签名密钥只存在两个 Worker 的 Secrets。OpenAI 收到的是短期 MCP 凭据，不会收到签名密钥。凭据不写入 D1 的任务输入，不提交 Git，不放浏览器。

staging 和生产使用不同密钥、各自 MCP 地址和数据库。仓库中的 `mcp.example.com` 是占位符；需要替换后才能启用。

### MCP 额外受 Cloudflare Access 保护时

保持 Access 保护。为该 MCP 应用创建 Service Token，添加允许该令牌的 **Service Auth** 策略。在 sync Worker 另配两个 Secret：

- `MCP_ACCESS_CLIENT_ID`
- `MCP_ACCESS_CLIENT_SECRET`

sync 将它们作为 MCP HTTP transport 的 `CF-Access-Client-Id` / `CF-Access-Client-Secret` 请求头交给 OpenAI。它们通过外层 Access；短期 JWT 验证站点内的任务身份。两层凭据用途不同，不需要自动化程序走邮箱或浏览器交互登录。

### 命令行设置示例

以下命令会修改目标 Worker 的运行时 Secrets，按对应环境授权执行。命令会交互提示输入值，避免把密钥写在命令参数里。

```bash
# staging，先部署关闭的 Worker，使 Worker 存在。
XDG_CONFIG_HOME="$PWD/.cache/xdg" npx wrangler secret put OPENAI_API_KEY --config apps/sync/wrangler.jsonc --env staging
XDG_CONFIG_HOME="$PWD/.cache/xdg" npx wrangler secret put AUTOMATION_SIGNING_SECRET --config apps/sync/wrangler.jsonc --env staging
XDG_CONFIG_HOME="$PWD/.cache/xdg" npx wrangler secret put AUTOMATION_SIGNING_SECRET --config apps/mcp/wrangler.jsonc --env staging
```

后两个提示填写同一个安全随机密钥，可以用本地密码管理器生成。生产将环境改成 `production`，使用另一套密钥。

## 部署与验收

遵循[项目发布流程](./release-workflow.md)。取得对应环境授权后，按顺序：

1. 对目标 D1 按顺序应用 `0008_official_sync.sql`、`0009_automation_mcp.sql`、`0010_official_sync_v2.sql`、`0011_bark_notifications.sql`。均为新增表或新增列，兼容旧 Web/MCP。
2. 配置实际 MCP 地址，部署 MCP 与保持关闭的 sync Worker。MCP 必须能被 OpenAI 通过 HTTPS 访问；如有 Access，配置上述服务令牌。
3. 设置 Worker Secrets，确认两个 Worker 绑定的是同一个目标 D1。
4. 在 staging 用 `SYNC_ENABLED=true`、`SYNC_AUTO_PUBLISH=false` 检查检索、认证和提案，再以 `true` 验收直接发布。
5. 生产单独执行 migration、配置与部署，不用 staging 数据库覆盖生产。

```bash
npm run deploy:staging --workspace @frip-fan/mcp
npm run deploy:staging --workspace @frip-fan/sync
```

MCP 和 sync 都不随现有 Web Worker 的自动部署一起发布。普通本地测试使用模拟请求，不产生 OpenAI 费用。真实 Agent 无法访问开发机的 localhost MCP；端到端验收使用可访问的 staging HTTPS 地址。

## 运维

`official_sync_runs.result_json` 是 Agent 的报告；`summary_json` 从真实关联的 change set 状态生成，不能只相信模型声称已发布。`official_sync_changes` 记录任务、提案与预览摘要。`audit_logs` 使用 `actor_id=official-sync-agent`、`channel=mcp` 记录写入，后台 `/admin/audit` 可查。

将 `SYNC_ENABLED=false` 可停止后续调度，但已运行的 OpenAI 任务仍可能在一小时有效期内调用 MCP。要立即撤销某个任务，可将其 run 标记为失败并取消 OpenAI session；轮换签名密钥会撤销该环境所有旧自动化凭据。`SYNC_AUTO_PUBLISH` 是新任务的授权配置，不回溯撤销已签发任务；当前任务的权限以 run 记录为准。

定期按需要清理历史同步记录和 OpenAI sessions。清理 run 前需先处理关联的 `official_sync_changes` 外键记录。回滚代码不撤销已发布内容。

参考：[Agents API MCP](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp)、[Agents API quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart)、[Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[Access Service Tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)。

## v2 编辑规则与费用控制

- 同日第1部/第2部独立；仅仅时间不同不代表独立活动，明确改期更新原活动。
- FC 旅行作为跨日 EVENT，未独立售票/报名的 mini live 记备注。公开的会员网播和现任成员个人出演可以收录。
- 标题保留日文，备注用简体中文；生日纪念日、会员制度、物流和报名截止不自动建日历。未知时间、未公开会场无需人工介入。
- 只开放所需 MCP 工具，不向模型返回整库或来源编辑者身份；同一 run 最多 80 次工具调用。
- `official_sync_sources` 保存正文/已处理哈希；`official_sync_reviews` 与 `official_sync_source_reviews` 保存自动复核状态。提案可修证据、重做预览或丢弃自身未发布错误草稿，已发布记录不自动清理。
- 模型启动前预留预算，用量按 session/turn 幂等记录，搜索调用另计。用量可能延迟到达，缺失时保留保守预留，不能按零元计算。预算是软控制，正在进行的调用可能超出；最终费用以 OpenAI 账单为准。

固定样例评测位于 `apps/sync/src/eval-cases.ts`。`scripts/prepare-sync-evaluation.ts` 仅生成忽略目录下的排队 SQL 与输入指纹，不自动部署、调用模型或发布活动。两模型使用相同冻结输入、medium reasoning、default service tier，无工具、无数据库内容写入；14 例是压缩事实与标明的合成对照，不是完整官网抓取准确率。预期答案不进入模型输入。临时验收 HTTP 控制器不属于应用代码，测试后应恢复无公开入口并删除临时密钥。

## 2026-10-30 生产准备

生产已应用迁移 0008、0009、0010，并单独部署：

- MCP：`frip-fan-mcp`，地址 `https://frip-fan-mcp.rklee.workers.dev/mcp`，绑定 `frip-fan-prod`，关闭开发认证绕过与 Preview URLs。
- sync：`frip-fan-sync`，绑定同一个生产库，`SYNC_ENABLED=false`、`SYNC_EVAL_ENABLED=false`；无公开 HTTP 入口。模型为 Luna 主跑、Sol 自动复核。
- 两个 Worker 已配置同一枚生产专用 `AUTOMATION_SIGNING_SECRET`，与 staging 独立。生产 `OPENAI_API_KEY` 由维护者通过 sync Worker 控制台的 Variables and Secrets 单独填写，不可从 staging Secret 读取或复制。

生产验证已通过：匿名请求被拒绝、短期凭据初始化及活动查询成功、只读任务不暴露发布工具、公开官网段落读取成功。验证任务已结束，未调用 OpenAI。准备前后生产活动总数均为 534、公开活动 532。准备阶段不导入 staging 内容，也不运行模型或发布活动。代码发布继续通过 staging → master 的发布 PR；在确认运行时密钥、身份验证与绑定正确后，另行启用生产同步。Worker 控制台中的 production deployment 表示该 Worker 的活动部署；环境以 Worker 名称和 D1 ID 为准。

## 正式运行状态

生产发布合并后，仅生产 `frip-fan-sync` 启用 `SYNC_ENABLED=true`，`SYNC_AUTO_PUBLISH=true`；staging 继续保持 `SYNC_ENABLED=false`。两边固定样例评测均关闭。生产每天最多启动一次同步，五分钟 Cron 用于收取任务进度；正文没有变化时跳过模型。模型保持 Luna 主跑、Sol 自动复核，预算组按日本日期划分，每日 $1 软控制不是预期日均费用。

生产和 staging 数据库独立。生产活动更新不会自动复制到 staging；需要新一轮测试时再单独开启测试同步或按项目流程刷新数据。停止生产同步应修改 production 的配置并单独部署 sync Worker，合并 Web 代码本身不会修改该 Worker 的运行开关。

## Bark 有更新通知

生产 sync Worker 通过 Bark 官方 HTTPS API 发送个人通知，不额外调用 OpenAI。`BARK_ENABLED=true` 且配置了 `BARK_DEVICE_KEY` 才工作；staging 默认 `BARK_ENABLED=false`。设备 key 只存 sync Worker Secret，不进入 Agent 输入、D1 通知内容、Git 或日志。`BARK_SITE_URL` 用于构建站内链接，生产为 `https://fripsi.de`。

每个自动同步任务结束后，按数据库里实际发布的活动合并为一条通知；同一活动在该轮的多次修改合并显示，草稿和无变化结果不推送。任务最终失败或 Sol 复核后仍有事项未解决，会单独在该轮通知中说明，部分已发布内容也会保留。正常的自动复核过程不通知。通知以本次任务最终结果为准，而不是官网一更新就实时发送；官网发现仍沿用日常同步频率。后台手动编辑本期不发送通知。

通知首次启用时保存激活时间，不补发之前已结束任务的历史通知。`official_sync_notifications` 保存无凭据的消息快照及状态，发布提交后由 Cron 独立收取，因此即使同步停用或某轮已失败，待发消息仍可重试。无变化的已结束任务记录为 skipped，避免队首空任务挡住后续更新。

发送采用带过期时间的领取锁，确认 Bark HTTP 成功且返回 code=200 才标记 sent。失败从 5 分钟开始退避，最长间隔 6 小时；通知失败不回滚发布、不重跑 Agent。网络丢失确认时仍可能出现少量重复投递，设备是否显示受 iOS 通知权限、专注模式和网络影响。

部署前先应用新增迁移 `0011_bark_notifications.sql`。手机端安装开发者 Finb 的 Bark 并允许通知，在生产 `frip-fan-sync` 的 Variables and Secrets 保存 `BARK_DEVICE_KEY`，只填官方推送地址最后一段 key。无需把完整地址或 key 发到聊天，也无需配置到 GitHub CI 或 MCP Worker。

Bark 自定义图标使用公开地址 `https://fripsi.de/bark-icon-v1.png`（iOS 15+）。PNG 为现有 `apps/web/public/fan-site-logo.svg` 的 512×512 导出，透明区域填充站点深蓝色；图标在发送时加入，因此旧的待发消息也可使用。发布时先确认生产 Web 静态资源可公开访问，再部署 sync。更新图片需改版本化文件名，避免 Bark/iOS 缓存旧图；staging 也使用生产公开图标，避免 Access 阻挡图片下载。
