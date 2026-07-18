import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ChangeService,
  assertScope,
  authenticateMcp,
  dateInTimeZone,
  duplicateInputSchema,
  findDuplicates,
  getEventById,
  listChangeSets,
  proposeCreateSchema,
  proposeLifecycleSchema,
  proposeStatusSchema,
  proposeUpdateSchema,
  searchEvents,
  searchInputSchema,
  ServiceError,
  type Actor
} from "@frip-fan/core";
import { z } from "zod";

interface Env {
  DB: D1Database;
  MCP_RESOURCE_URL?: string;
  SITE_URL?: string;
  MCP_AUTHORIZATION_SERVER?: string;
  ACCESS_TEAM_DOMAIN?: string;
  MCP_AUDIENCE?: string;
  DEV_AUTH_BYPASS?: string;
  DEV_ACTOR?: string;
}

function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data }
  };
}

function failure(error: unknown) {
  const known = error instanceof ServiceError;
  const payload = {
    error: {
      code: known ? error.code : "internal_error",
      message: known ? error.message : "工具执行失败",
      ...(known && error.details ? { details: error.details } : {})
    }
  };
  return { ...result(payload), isError: true };
}

function createServer(env: Env, actor: Actor): McpServer {
  const server = new McpServer(
    { name: "fripSide Event Archive", version: "0.1.0" },
    {
      instructions: [
        "这是 fripSide 粉丝活动档案的受控编辑接口。",
        "新增前必须先调用 events.search 或 events.check_duplicate。",
        "事实变更必须携带 HTTPS 来源。写操作只能创建 change set，不能直接修改活动。",
        "发布前必须调用 changes.preview，并且只有用户明确确认后才可调用 changes.publish（confirm=true）。",
        "取消、下线和归档同样需要明确确认。工具失败时不得声称成功。"
      ].join(" ")
    }
  );
  const changes = new ChangeService(env.DB);

  server.registerTool("events.search", {
    title: "搜索活动",
    description: "按关键词、日期、分类、状态和公开状态查询活动。新增或更新前先使用此工具检查现有内容。",
    inputSchema: searchInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      assertScope(actor, "events:read");
      const events = await searchEvents(env.DB, input);
      return result({ events, count: events.length });
    }
    catch (error) { return failure(error); }
  });

  server.registerTool("events.get", {
    title: "读取活动详情",
    description: "读取单个活动、来源、当前版本和未完成变更提案。",
    inputSchema: z.object({ event_id: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ event_id }) => {
    try {
      assertScope(actor, "events:read");
      const event = await getEventById(env.DB, event_id);
      if (!event) throw new ServiceError("not_found", "没有找到活动", 404);
      const proposals = (await listChangeSets(env.DB, "proposed", 200)).filter((change) => change.target_event_id === event_id);
      return result({ event, pending_changes: proposals });
    } catch (error) { return failure(error); }
  });

  server.registerTool("events.list_upcoming", {
    title: "近期活动",
    description: "读取当前日期之后的活动，用于了解日历现状。",
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ limit }) => {
    try { assertScope(actor, "events:read"); return result({ events: await searchEvents(env.DB, { date_from: dateInTimeZone(), statuses: ["scheduled", "cancelled", "postponed"], limit }) }); }
    catch (error) { return failure(error); }
  });

  server.registerTool("events.check_duplicate", {
    title: "检查重复活动",
    description: "根据日期范围、标题、场地和来源 URL 返回可能重复的活动。提出新增前必须调用。",
    inputSchema: duplicateInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    try { assertScope(actor, "events:read"); return result({ candidates: await findDuplicates(env.DB, input) }); }
    catch (error) { return failure(error); }
  });

  server.registerTool("changes.propose_create", {
    title: "提出新增活动",
    description: "创建一个待审核的新增提案，不会直接公开。至少需要一个 HTTPS 官方来源和唯一幂等键。",
    inputSchema: proposeCreateSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    try { return result({ change: await changes.proposeCreate(input, actor), next_step: "调用 changes.preview；用户确认后再发布" }); }
    catch (error) { return failure(error); }
  });

  server.registerTool("changes.propose_update", {
    title: "提出修改活动",
    description: "基于 expected_version 创建字段修改提案，不直接修改活动。patch 只包含要变更的字段。",
    inputSchema: proposeUpdateSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    try { return result({ change: await changes.proposeUpdate(input, actor), next_step: "调用 changes.preview" }); }
    catch (error) { return failure(error); }
  });

  server.registerTool("changes.propose_status", {
    title: "提出状态变更",
    description: "提出 scheduled、completed、cancelled 或 postponed 状态变更；不会直接发布。",
    inputSchema: proposeStatusSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    try { return result({ change: await changes.proposeStatus(input, actor), next_step: "调用 changes.preview" }); }
    catch (error) { return failure(error); }
  });

  const lifecycle = (name: "unpublish" | "archive" | "restore", destructive: boolean) => {
    server.registerTool(`changes.propose_${name}`, {
      title: name === "unpublish" ? "提出下线" : name === "archive" ? "提出归档" : "提出恢复",
      description: `${name} 只创建待审核提案，必须再次预览并经用户确认发布。`,
      inputSchema: proposeLifecycleSchema,
      annotations: { readOnlyHint: false, destructiveHint: destructive, idempotentHint: true, openWorldHint: false }
    }, async (input) => {
      try { return result({ change: await changes.proposeLifecycle(name, input, actor), next_step: "调用 changes.preview" }); }
      catch (error) { return failure(error); }
    });
  };
  lifecycle("unpublish", true);
  lifecycle("archive", true);
  lifecycle("restore", false);

  server.registerTool("changes.preview", {
    title: "预览变更",
    description: "返回 before/after、字段差异所需数据、重复候选、警告和预估公开 URL。发布前必须调用。",
    inputSchema: z.object({ change_set_id: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ change_set_id }) => {
    try { return result(await changes.preview(change_set_id, actor)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("changes.publish", {
    title: "发布已确认变更",
    description: "立即应用已经预览的 change set。只有用户明确确认后才能传 confirm=true；服务端会检查 scope、状态和版本。",
    inputSchema: z.object({
      change_set_id: z.string().min(1),
      idempotency_key: z.string().min(8).max(200),
      confirm: z.literal(true).describe("必须代表用户已经明确确认本次公开变更")
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ change_set_id, idempotency_key }) => {
    try {
      const event = await changes.publish(change_set_id, actor, idempotency_key);
      return result({ published: true, event, public_url: `${(env.SITE_URL ?? "https://example.com").replace(/\/$/, "")}/events/${event.slug}` });
    } catch (error) { return failure(error); }
  });

  server.registerTool("changes.discard", {
    title: "丢弃变更提案",
    description: "丢弃尚未发布的 change set；不会删除活动。",
    inputSchema: z.object({ change_set_id: z.string().min(1), confirm: z.literal(true) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ change_set_id }) => {
    try { return result({ change: await changes.discard(change_set_id, actor) }); }
    catch (error) { return failure(error); }
  });

  return server;
}

function protectedResourceMetadata(env: Env) {
  const origin = (env.MCP_RESOURCE_URL ?? "https://mcp.example.com").replace(/\/$/, "");
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [env.MCP_AUTHORIZATION_SERVER ?? (env.ACCESS_TEAM_DOMAIN?.startsWith("https://") ? env.ACCESS_TEAM_DOMAIN : `https://${env.ACCESS_TEAM_DOMAIN ?? "your-team.cloudflareaccess.com"}`)],
    scopes_supported: ["events:read", "events:draft", "events:publish", "events:archive"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/`
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health") return Response.json({ ok: true, service: "frip-fan-mcp", version: "0.1.0" });
    if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
      return Response.json(protectedResourceMetadata(env), { headers: { "cache-control": "public, max-age=300" } });
    }
    if (path !== "/mcp") return new Response("Not found", { status: 404 });
    try {
      const actor = await authenticateMcp(request, env);
      return createMcpHandler(createServer(env, actor), {
        route: "/mcp",
        enableJsonResponse: true
      })(request, env, ctx);
    } catch (error) {
      const status = error instanceof ServiceError ? error.status : 401;
      const message = error instanceof Error ? error.message : "Unauthorized";
      const origin = new URL(request.url).origin;
      return Response.json({ error: "invalid_token", error_description: message }, {
        status,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
          "cache-control": "no-store"
        }
      });
    }
  }
} satisfies ExportedHandler<Env>;
