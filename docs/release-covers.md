# 专辑封面

发行物列表与详情页从本站 `/media/covers/<sha256>.<ext>` 加载图片。官网只用于导入和来源核查，访客浏览时不会向官网请求封面。

## 存储和读取

| 环境 | 存储位置 | 图片访问 |
|---|---|---|
| 生产 | 主机 `/var/lib/fripside/media/covers/` | `https://fripsi.de/media/covers/…` |
| 测试 | 测试主机 `/var/lib/fripside/media/covers/` | 测试站 `/media/covers/…`，沿用 Access 与服务端鉴权 |
| 本地开发 | `FRIP_MEDIA_DIR`，默认 `apps/web/.cache/self-hosted/media` | 本地网站 `/media/covers/…` |

业务代码通过 `MEDIA`（R2 风格接口）读写，Node 运行时由 `packages/node-runtime` 的 `localMedia` 映射到上述目录。只读取 `covers/` 下符合哈希命名规则的图片，不开放目录列表、其他路径或任意文件上传。正式图片返回一年 immutable 浏览器缓存和 ETag，支持 HEAD 与 304，并由 Cloudflare 缓存；测试站中间件覆盖为 `private, no-store`，避免绕过访问控制。

图片按内容 SHA-256 去重，保留原始字节，不裁切或重编码；列表延迟加载并预留正方形空间。更换封面会产生新路径，避免缓存旧图。共享或旧图片不随专辑编辑删除，防止影响其他发行记录。

封面目录不在数据库备份范围内，见 [SQLite 备份与恢复](sqlite-backups.md)。

## 后台维护

在专辑表单的「导入封面」填写 `https://fripside.net/s3/skiyaki/uploads/…` 图片链接和 `/musics/<id>` 官网来源页面，点击保存。服务端先下载并校验图片、写入当前环境的封面目录，成功后再保存数据库中的本站图片路径。留空保留当前图片；勾选「移除现有封面」可清空关联。

导入限制为官网同源地址与重定向，20 秒超时、最多 8 MB，并检查 JPEG／PNG／WebP／GIF 文件签名，不接受 SVG 或 HTML。管理员预览可直接加载待导入的官网图片；公开页面 CSP 只允许本站封面。保存沿用原有权限、审计、幂等和并发校验。写入图片失败不会保存新路径；数据库保存冲突可能留下可复用的未关联图片。

部分官网发行页没有真正的封面，返回 1×1 像素图片；前端把这种图片当作缺失封面，显示占位符号。

## 官网封面资料

`data/research/fripside-official-covers.json` 保存公开官网发行页、图片链接、版本标题、品番与核验时间；`data/research/fripside-r2-covers.json` 保存已导入图片的公开来源映射。版本匹配复用 discography normalization：按品番匹配，合并相同音源版本时优先对应通常盘，否则使用首个匹配版本；官网未提供版本图时使用主图，品番不匹配时不会借用其他版本图。图片二进制不提交 Git。

```bash
# 重新采集公开官网资料（需要 Playwright Chromium）
npm run scrape:release-covers
# 生成版本匹配报告，不写数据库
npm run build:release-covers
```

新增或更换少量封面使用后台导入。`scripts/import-release-covers-r2.ts` 是迁移前批量上传到 R2 桶的脚本，不适用于当前主机目录；需要批量导入时应另行编写限定范围的变更包（图片写入封面目录、数据库只填充空封面），按 [发布流程](release-workflow.md#内容变更) 单独执行。
