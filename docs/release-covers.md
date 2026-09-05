# 专辑封面与 R2

发行物列表与详情页从本站 `/media/covers/<sha256>.<ext>` 加载图片。原始图片保存在私有 R2 桶中，官网只用于导入和来源核查，访客浏览时不会向官网请求封面。

## 存储和读取

| 环境 | `MEDIA` binding 对应桶 | 图片访问 |
|---|---|---|
| 本地 | `frip-fan-media-dev`（本地模拟） | 本地网站 `/media/covers/…` |
| 测试 | `frip-fan-media-staging` | 测试站 `/media/covers/…`，沿用 Access 与服务端鉴权 |
| 正式 | `frip-fan-media-prod` | `https://fripsi.de/media/covers/…` |

桶保持私有，不启用 `r2.dev` 或公开桶域名。Worker 只读取 `covers/` 下符合哈希命名规则的图片，不开放桶列表、其他路径或任意文件上传。正式图片返回一年 immutable 浏览器缓存和 ETag，支持 HEAD 与 304；测试站中间件覆盖为 `private, no-store`，避免绕过现有访问控制。

图片按内容 SHA-256 去重，保留原始字节。首版不裁切或重编码图片；列表延迟加载且预留正方形空间。更换封面产生新路径，避免缓存中出现旧图。共享或旧图片不随专辑编辑删除，防止影响其他发行记录。

## 后台维护

在专辑表单的「导入封面」填写 `https://fripside.net/s3/skiyaki/uploads/…` 图片链接，填写 `/musics/<id>` 官网来源页面，点击保存。服务端先下载和校验图片、写入当前环境 R2，成功后再保存 D1 的本站图片路径。留空保留当前图片；勾选「移除现有封面」可清空关联。

导入限制为官网同源地址与重定向，20 秒超时、最多 8 MB，并检查 JPEG／PNG／WebP／GIF 文件签名，不接受 SVG 或 HTML。管理员预览可直接加载待导入官网图片；公开页面 CSP 仅允许本站封面。保存继续沿用原有权限、审计、幂等和并发校验。R2 失败不会将新路径写入 D1；D1 保存冲突可能留下可复用的未关联图片。

单图后台导入在 R2 对象元数据中保存官网原图和来源页。批量导入的公开来源映射保存于 `data/research/fripside-r2-covers.json`；带本地文件路径的完整清单保存于忽略的 `data/raw/release-covers/manifest.json`。图片二进制始终不提交 Git。

## 历史封面导入

`data/research/fripside-official-covers.json` 保存 60 个公开官网发行页、图片链接、版本标题、品番与核验时间。版本匹配复用 discography normalization：按品番匹配，合并相同音源版本时优先对应通常盘，否则使用首个匹配版本；官网未提供版本图时使用主图。品番不匹配时不会借用其他版本图。

```bash
# 重新采集公开官网资料（Playwright Chromium 及其系统依赖）
npm run scrape:release-covers
# 生成版本匹配报告，不写数据库
npm run build:release-covers
# 下载图片、生成哈希命名文件及原图映射；不上传
npx tsx scripts/import-release-covers-r2.ts --environment local
# 写入指定环境的桶并逐个读回验证 SHA-256
npx tsx scripts/import-release-covers-r2.ts --environment local --upload
npx tsx scripts/import-release-covers-r2.ts --environment staging --upload
npx tsx scripts/import-release-covers-r2.ts --environment production --upload
```

每次上传只针对指定桶。只有全部图片上传并读回成功，才会生成该环境的 `data/normalized/fripside-release-covers-<environment>.sql` 和 `data/raw/release-covers/receipt-<environment>.json`。脚本不执行 D1 变更。重复上传的相同哈希路径对应相同字节。

## 发布顺序

1. 创建两个私有远程桶并上传封面，核对上传回执；本地仅使用模拟桶。
2. 先在目标环境应用 `migrations/0007_release_covers.sql`，再部署代码与 `MEDIA` binding。迁移只增加 nullable 字段，兼容旧代码。
3. 核对并单独应用目标环境封面 SQL。SQL 同时匹配 slug、日期和已有 `catalog_sources`。只填充空封面，或将本批次已知官网原图 URL 转成本地路径；其他人工封面不会被覆盖。更新推进 `updated_at`，旧后台表单将触发并发冲突。
4. 核对实际更新数、浏览器图片请求、缓存和各版本展示。生成包条数不代表目标环境实际更新数。

新增图片字段不需要 MCP 的 R2 binding：MCP 仅查询音乐资料；图片导入由 Web 后台执行。Git 合并、Worker 部署和 schema migration 均不会自动补充 D1 封面内容。完整流程见 [发布流程](release-workflow.md)。

修改 binding 后重新生成类型：

```bash
XDG_CONFIG_HOME="$PWD/.cache/xdg" npx wrangler types apps/web/src/worker-bindings.d.ts --config apps/web/wrangler.jsonc --env-interface WebWorkerBindings --include-runtime false --strict-vars false
```
