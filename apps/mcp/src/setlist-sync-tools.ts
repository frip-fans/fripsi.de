import type { McpServer } from "@modelcontextprotocol/server";
import { SetlistAutomationService, syncSetlistSchema, syncSongSchema, type Actor } from "@frip-fan/core";
import { z } from "zod";
import { failure, result } from "./tool-result";

/** The only tools the setlist collection task gets: find or add songs, then add a setlist to one of its events. */
export function registerSetlistSyncTools(server: McpServer, env: { DB: D1Database; SITE_URL?: string }, actor: Actor): void {
  const automation = new SetlistAutomationService(env.DB);
  const call = async (work: () => Promise<unknown>) => { try { return result(await work()); } catch (error) { return failure(error); } };

  server.registerTool("sync.find_songs", {
    title: "查音乐库里有没有这首歌",
    description: "按歌名查歌曲，忽略大小写、全半角、空格和标点，也会去掉 -version2024- 这类版本标记后再查。exists=true 时 matches 就是这首歌，直接用它的 song_id；exists=false 时先看 similar 里有没有同一首歌的另一种写法，确实没有才可以新建。歌单里的每一首都要先查。",
    inputSchema: z.object({ query: z.string().trim().min(1).max(240) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ query }) => call(() => automation.findSongs(query, actor)));

  server.registerTool("sync.create_song", {
    title: "新建音乐库里没有的歌曲",
    description: "只在 sync.find_songs 确认音乐库没有这首歌之后使用。歌名用原名，不带版本标记。服务端会再查一次重名，已有的歌会被拒绝并返回已有歌曲的 song_id。每次任务新建数量有上限。",
    inputSchema: syncSongSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (input) => call(() => automation.createSong(input, actor)));

  server.registerTool("sync.propose_setlist", {
    title: "为已结束的演出提交歌单",
    description: "只能用于任务输入 events 中的活动。曲目按演出顺序完整列出，song_id 取自 sync.find_songs 或 sync.create_song，不要编造。对同一场演出再次提交会替换上一次的提案。返回 change_set_id 后调用 changes.preview。",
    inputSchema: syncSetlistSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (input) => call(() => automation.proposeSetlist(input, actor)));

  server.registerTool("changes.preview", {
    title: "预览歌单提案",
    description: "查看提案保存后的完整曲目和警告，取得 preview_digest。有警告时不能发布。",
    inputSchema: z.object({ change_set_id: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ change_set_id }) => call(() => automation.preview(change_set_id, actor)));

  if (actor.scopes.includes("events:auto_publish")) server.registerTool("changes.publish_automatic", {
    title: "发布已预览的歌单",
    description: "基于维护者的持续授权，发布本次任务已预览的新增歌单，无需逐条人工确认。必须携带本次 preview_digest。",
    inputSchema: z.object({ change_set_id: z.string().min(1), preview_digest: z.string().regex(/^[a-f0-9]{64}$/) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, ({ change_set_id, preview_digest }) => call(async () => {
    const outcome = await automation.publish(change_set_id, preview_digest, actor);
    return { ...outcome, change_set_id: outcome.change_id,
      ...(outcome.status === "published" && outcome.setlist_id ? { public_url: `${(env.SITE_URL ?? "https://fripsi.de").replace(/\/$/, "")}/music/lives/${encodeURIComponent(outcome.setlist_id)}` } : {}) };
  }));
}
