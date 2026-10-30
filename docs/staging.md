# Cloudflare staging

测试站地址：`https://frip-fan-web-staging.rklee.workers.dev`。

- Worker：`frip-fan-web-staging`
- D1：`frip-fan-staging`（`32c5a88c-bbd1-4bda-9814-b8cce16fc7c4`）
- 配置：`apps/web/wrangler.jsonc` 中的 `env.staging`
- 运行时：`APP_ENV=staging`

## 登录保护

在 Cloudflare Zero Trust 创建独立的 Self-hosted Access 应用，保护该 Worker 的全部流量（可从 Workers → frip-fan-web-staging → Access → Protect this Worker behind Access，选择 All traffic）。范围应覆盖此测试 Worker 的固定 workers.dev 入口。Allow 策略只包含测试管理员邮箱。把该应用的 AUD 写入 `env.staging.vars.ACCESS_AUD`，并确保 `ACCESS_TEAM_DOMAIN` 与该应用所在的 Zero Trust 团队一致。

`ADMIN_PUBLISHERS` 是测试站允许访问和编辑的邮箱列表。所有 SSR 页面/API 均验证 Access JWT 和邮箱，强制关闭开发身份绕过；缺少 AUD 时拒绝访问。静态资源由 Cloudflare 提供，因此完整站点保护仍需要边缘 Access 应用。固定 `workers.dev` 入口启用，Preview URLs 关闭；自定义测试域名不再绑定。

测试站响应包含 `X-Robots-Tag: noindex, nofollow`，SSR 响应不缓存；Giscus 正式评论组件不加载。

## 部署

在仓库根目录运行：

```bash
npm run typecheck
npm test
npm run deploy:web:staging
```

此命令先通过 `CLOUDFLARE_ENV=staging` 构建，再通过 `wrangler deploy` 更新独立测试 Worker 的活动版本。这是测试 Worker 自己的 production deployment；Wrangler 配置仍选择 staging，以保持测试库和生产库隔离。不要直接复用生产构建产物。`npm run deploy:web` 仍然部署生产环境。

Wrangler 登录状态位于 `.cache/xdg`：

```bash
XDG_CONFIG_HOME="$PWD/.cache/xdg" npx wrangler login --device --browser=false
```

## 数据初始化与更新

测试库是独立数据库，不自动同步生产。完整生产快照可能包含审计记录和邮箱；导出到服务器前需要明确授权，导出期间 D1 会阻塞其他数据库查询。

初次部署应把授权的生产 SQL 快照导入空的测试库，核对业务表记录数、迁移记录及外键完整性。若之后代码增加 migration，只向测试库应用新增 migration。不要在已有测试内容的库中直接叠加完整快照，也不要将测试库反向覆盖到生产。

导出和验证中间文件保存于被 Git 忽略的 `.cache/staging/`。

Web 分支自动部署已配置：推送 staging 更新测试站，合并到 master 更新生产站，构建前均执行类型检查和测试。详见 [发布流程](./release-workflow.md)。MCP 和 sync 使用独立部署命令，不随 Web 分支自动发布。手动命令仍可用于部署当前服务器工作区代码。

## 2026-10-30 自动同步测试环境

- 新建 `frip-fan-mcp-staging`：`https://frip-fan-mcp-staging.rklee.workers.dev/mcp`。
- 新建 `frip-fan-sync-staging`，无公开 HTTP 入口，`SYNC_ENABLED=false`。
- 模型按维护者选择配置为 `gpt-6-luna`，先验收效果；必要时再换 `gpt-6.1-sol`。
- 两个 Worker 均绑定已有 `frip-fan-staging`，初次应用新增迁移 0008、0009。初始化时活动数保持 534，外键检查通过。未改动 Web Worker 或生产环境。
- 两边已配置相同的随机 `AUTOMATION_SIGNING_SECRET`，不在文档记录其值。OpenAI API key 已由维护者通过控制台配置。
- 已远程验证 MCP 健康检查、匿名请求被拒绝、短期任务凭据可初始化并读取活动、只读提案任务不暴露发布工具。初始认证验证任务均已结束，未写活动、未调用 OpenAI。
- workers.dev 会对某些通用库默认 User-Agent 返回 1010；验证客户端与 Agent 的 MCP transport 使用真实应用标识，不伪装浏览器。

密钥和后续启用步骤见[官方活动自动同步](./official-sync.md)。

### Luna 首次试跑

- 使用一个 `gpt-6-luna` Agent session，实际调用网页搜索 3 次、MCP 28 次。最终 1 条新增已自动发布，2 条因引文证据不连续而保留待审核；不能把发布比例当作事实抽取准确率。
- 测试库活动总数从 534 增至 535；正式站只做了公开记录的只读审查，没有生产写入。试跑结束后恢复 `SYNC_ENABLED=false`。
- Provider 报告累计输入 922,873 token（缓存命中 840,099）、输出 14,440 token。按当日标准短上下文价和 3 次搜索粗估约 $0.054，仅供核算参考，排除 Cloudflare 或其他未报告费用，不是费用上限。
- 启动阶段遇到 Workers 不支持 `redirect: "error"` 的运行时问题，已改为 `manual` 并对重定向作为失败处理。这些发生在发出请求前的启动错误不计入模型质量评估。
- 该试跑使用 v1 连续引文方案；v2 已改为官网正文版本哈希和段落 ID 引用，保留此次历史结果，不据此计算 v2 发布率。

## 2026-09-05 初始化记录

已获授权，将生产完整 SQL 快照导入独立测试库。25 张表记录数与快照一致，外键检查无违规；包含 534 个活动、279 首歌曲、64 个发行物、166 份歌单及 6 条迁移记录。生产数据库未被写入。

### v2 固定案例对比（2026-10-30）

- 维护者授权临时带随机 Secret 鉴权的 staging 测试入口，共享 $1 软预算；不修改生产。临时入口不进入应用源码，验收后恢复关闭状态并删除临时 Secret。
- 两模型各运行一次相同冻结输入（指纹 `e18b47055b18`），14 个压缩案例，medium reasoning、default tier、无联网/工具/内容写入。原始分数 Luna 11/14，Sol 12/14；保留原始结果，不用后改规则提高分数。
- 两者共同失败项为电视/发行日的地点模式：评测未列举有效枚举而允许自由字符串，模型返回 null；此外两者的现场模式用了无效别名。Luna 另将“专场”写成“ワンマン”。据此补全地点枚举说明、收紧后续评测 schema，服务端增加专场别名归一化。修后未重跑这组付费对比，不宣称 14/14。
- 相同日期分部、25:58 跨日、开场/开演区分、改期更新原活动、旅行合并、未公开会场、已存在不重复、模板笔误、真实冲突复核等关键决策，两者表现接近。这一小样本不足以证明换强模型能显著改善全流程；维持 Luna 主跑、Sol 有限自动复核。
- 两次评测延迟回报的标准价格用量估算合计 $0.0421716（Luna $0.0025956、Sol $0.039576）。缺失用量不能按零计算，金额以账单为准。
- 真实官网串联验收首先发现 Agents API 不接受报告中 `format: uri` 的 schema 约束；移除发送给 API 的该约束，保留本地 URL 校验后成功创建会话。参数拒绝阶段尚未创建会话；不能归因为模型能力。

### v2 真实官网与 MCP 串联结果

- 任务 `trial-v2-2026-10-30` 已完成：Luna 主跑，Sol 自动复核一次；11 篇官网来源，服务端计数 71 次工具调用。工具 schema 提前拒绝的请求不计入此服务端计数，仍会消耗模型 token。
- 产生 2 条提案且预览成功：11 月 24 日第 31 回会员生放送新增，以及将首次试跑的独立 mini live 修正为 12 月 5–6 日跨日 FC 旅行的更新。任务 `auto_publish=false`，没有发布任何活动。测试库活动数仍为 535。
- Sol 自行修复了旅行提案的参数问题。Skream! 已公开报道被日期证据规则挡住，根因为服务端漏识别“公開されました”；已补回归测试并修复，且仅在没有其他明确事实日期时使用公告日期。该修复未重新进行付费实跑。
- 实跑还出现 limit 超出 25、可选 venue_id 错填 null、online 缺少 channels 等格式错误。提示已明确上限、可选 ID 应省略及渠道要求；失败后能继续修复不代表首次调用正确，不能宣称免干预率 100%。
- 4 个完成会话（2 个固定评测、1 个 Luna 主任务、1 个 Sol 复核）的延迟用量补读后，标准模型价格估算合计 **$0.15643663**；本轮无网页搜索调用，未超过共享 $1 软预算。排除 Cloudflare 与其他未报告费用，最终以账单为准。
- 维护版 staging sync 已恢复：`SYNC_ENABLED=false`、`SYNC_EVAL_ENABLED=false`、`workers_dev=false`，正常五分钟 Cron 仍在，但开关关闭时不会调用 OpenAI。临时 HTTP 控制器不进入仓库。生产 Web、生产 D1 和生产同步配置均未改动。
- 已删除远端 `SYNC_OPERATOR_SECRET` 和本地临时控制器/密钥；保留的测试结果与用量不含凭据。

### v2 自动发布验收（2026-10-30）

维护者批准在 staging 开启自动发布后，创建限定 3 篇真实官网公告的任务 `staging-publish-v2-2026-10-30`。使用维护版 Worker 的 Cron，无公开 HTTP 测试入口，仍沿用 `sync-v2-evaluation-2026-10-30` 的共享 $1 软预算。输入冻结为最新提示和官网 URL，证据由 MCP 实时读取、发布前刷新验证；不人工代替模型发布提案。

基线为 535 个活动，原 mini live 为 `LIVE`、2026-12-05、无结束日期、version 1。Luna 已实际发布 Skream! 报道与第 31 回会员生放送两条新增，并将旅行关键修改交给 Sol 自动复核。

最终内容核验：两条新增和一条更新均为 `published`；活动总数 535 → 537。会员生放送为 MEDIA/生放送，2026-11-24 20:30；Skream! 刊登为 MEDIA/WEB，2026-10-16；旅行为 EVENT/freakSide，2026-12-05 至 2026-12-06。旅行保留原 event ID 和 slug，version 1 → 2。外键检查无违规。三个发布审计均由 Agent 经 MCP 完成。

任务最终 `completed`，服务端计数 35 次工具调用，Sol 复核队列已解决。此轮模型费用估算 **$0.07006112**，连同此前评测/试跑的共享预算累计 **$0.22649775**（无网页搜索调用，排除 Cloudflare 等费用，以账单为准）。

验收后已重新部署关闭的维护版 sync：`SYNC_ENABLED=false`、`SYNC_EVAL_ENABLED=false`，恢复 `*/5 * * * *` Cron；`workers_dev=false`，未添加测试 Secret。生产未改动。测试发布内容保留在 staging，不会随代码合并自动进入生产。

### 十月会员生放送补录（2026-10-30）

维护者发现第 30 回缺失：官网 `/contents/1113518` 公告发表于 9 月 26 日，活动实际为 10 月 23 日 20:30，超过原来的 14 天公告发现窗口。此前三篇指定公告的验收不能证明历史覆盖完整。发现层增加 60 天范围、最多 4 页目录，按未读/刷新时间轮转，避免已处理的队首占满 16 篇名额。真实目录的分页格式为 `/contents/news/page/2`，已验证并加入回归案例；121 项测试和类型检查通过，真实分页路径修正后的定向测试 9 项通过。

维护者随后选择这次手动补录。已在模型启动前取消 `staging-backfill-october-2026-10-30`（session ID 为空、工具调用 0），恢复关闭调度。使用现有 ChangeService 完成提案、查重、预览、发布和审计：`2026-10-23-freakside-30`，MEDIA/生放送，Asia/Tokyo 20:30，官方公开来源与会员限定备注均已保存。审计身份为 `codex:staging-manual-backfill`，不伪装为自动 Agent；没有新增 OpenAI 费用。活动总数 537 → 538，生产未改动。
