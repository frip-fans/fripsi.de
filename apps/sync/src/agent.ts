import { boundedText } from "@frip-fan/core";
import { z } from "zod";

export const agentReportSchema = z.object({
  summary: z.string().max(2000),
  published_change_ids: z.array(z.string()).max(20),
  review_change_ids: z.array(z.string()).max(20),
  notes: z.array(z.string().max(1000)).max(20),
  source_outcomes: z.array(z.object({ source_url: z.url(), decision: z.enum(["published", "proposed", "unchanged", "ignored", "review"]), reason: z.string().max(500) })).max(30).default([]),
});
const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  input_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative() }).optional(),
  output_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative() }).optional(),
});
export type Usage = z.infer<typeof usageSchema>;
export interface SessionProgress { state: "running" | "completed" | "failed"; turn_id?: string; usage?: Usage; output?: unknown; tools?: { web_search_calls: number; mcp_calls: Array<{ name: string; status: string }>; history_complete: boolean } }
export type AgentReport = z.infer<typeof agentReportSchema> & {
  observed_usage?: z.infer<typeof usageSchema>;
  observed_tools?: { web_search_calls: number; mcp_calls: Array<{ name: string; status: string }>; history_complete: boolean };
};

export { instructions } from "./prompt";
import { instructions } from "./prompt";

export class AgentsClient {
  constructor(private readonly key: string, private readonly request: typeof fetch = fetch.bind(globalThis)) {}

  async call(path: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
    const key = this.key.trim();
    if (!key || /\s/.test(key)) throw new Error("openai_key_format_invalid");
    const encodedBody = body === undefined ? undefined : JSON.stringify(body);
    console.log(JSON.stringify({ action: "official_sync.request_ready", operation: path === "sessions" ? "create_session" : "read_or_continue_session" }));
    const response = await this.request(`https://api.openai.com/v1/agents/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "OpenAI-Beta": "agents=v1",
        "content-type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: encodedBody,
      signal: AbortSignal.timeout(20_000),
      // Workers supports follow/manual, not the Fetch standard's error mode.
      // Return redirects as non-OK responses rather than forwarding credentials.
      redirect: "manual",
    });
    console.log(JSON.stringify({ action: "official_sync.openai_response", status: response.status }));
    if (!response.ok) {
      // Only log known error identifiers. Provider messages can echo credentials or input.
      try {
        const data = JSON.parse(await boundedText(response, 32_768));
        const allowedCodes = ["invalid_api_key", "insufficient_quota", "model_not_found", "permission_denied", "invalid_value", "missing_required_parameter", "unknown_parameter", "unsupported_parameter", "invalid_json_schema"];
        const error = data?.error;
        const param = typeof error?.param === "string" && /^(?:agent|environment|input|stream|model|tools|text|format|reasoning)(?:\.[a-z_]+|\[\d+\])*$/.test(error.param) ? error.param : undefined;
        const hints = typeof error?.message === "string" ? ["json_schema", "default", "format", "uri", "required", "additionalProperties", "context_size", "source_outcomes", "Idempotency"].filter((hint) => error.message.includes(hint)) : [];
        console.error(JSON.stringify({ action: "official_sync.openai_error", status: response.status, hints,
          ...(allowedCodes.includes(error?.code) ? { code: error.code } : {}), ...(param ? { param } : {}) }));
      } catch { /* Keep unstructured or oversized provider bodies out of logs. */ }
      throw new Error(`openai_http_${response.status}`);
    }
    return JSON.parse(await boundedText(response));
  }

  async start(model: string, input: unknown, key: string, mcp: { url: string; authorization: string; autoPublish: boolean; headers?: Record<string, string> }, prompt = instructions): Promise<string> {
    const schema = z.toJSONSchema(agentReportSchema, { unrepresentable: "any", override: ({ jsonSchema }) => {
      // Structured Outputs does not accept JSON Schema's general URI format.
      // Retain z.url() validation when parsing the completed report locally.
      if (jsonSchema.format === "uri") delete jsonSchema.format;
    } });
    console.log(JSON.stringify({ action: "official_sync.schema_ready" }));
    const session = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]+$/) }).parse(await this.call("sessions", {
      agent: {
        model,
        instructions: prompt,
        reasoning: { effort: "medium" },
        service_tier: "default",
        tools: [
          { type: "web_search", mode: "live", allowed_domains: ["fripside.net", "www.fripside.net"], context_size: "medium" },
          { type: "mcp", server_label: "fripsi", connection_origin: "service", required: true,
            transport: { type: "http", server_url: mcp.url, authorization: mcp.authorization,
              headers: { "User-Agent": "fripsi-official-sync/1.0", ...mcp.headers } },
            allowed_tools: ["events.search", "events.get", "events.list_upcoming", "events.check_duplicate", "sources.read", "sync.propose", "sync.inspect", "sync.discard", "sync.request_review", "changes.preview",
              ...(mcp.autoPublish ? ["changes.publish_automatic"] : [])] },
        ],
        text: { format: { type: "json_schema", schema } },
      },
      environment: { type: "none" },
      input: JSON.stringify(input),
    }, key));
    return session.id;
  }

  async startEvaluation(model: string, input: unknown, key: string, schema: Record<string, unknown>, prompt: string): Promise<string> {
    const session = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]+$/) }).parse(await this.call("sessions", {
      agent: { model, instructions: prompt, reasoning: { effort: "medium" }, service_tier: "default",
        tools: [], text: { format: { type: "json_schema", schema }, verbosity: "low" } },
      environment: { type: "none" }, input: JSON.stringify(input),
    }, key));
    return session.id;
  }

  async progress(sessionId: string): Promise<SessionProgress> {
    const path = `sessions/${encodeURIComponent(sessionId)}`;
    const turns = z.object({ data: z.array(z.object({ id: z.string(), status: z.string(), usage: z.unknown().optional() })) })
      .parse(await this.call(`${path}/turns?order=desc&limit=1`));
    const turn = turns.data[0];
    if (!turn) return { state: "running" };
    const usage = usageSchema.safeParse(turn.usage);
    const base = { turn_id: turn.id, ...(usage.success ? { usage: usage.data } : {}) };
    if (["queued", "in_progress", "waiting"].includes(turn.status)) return { ...base, state: "running" };
    if (turn.status !== "completed") return { ...base, state: "failed" };
    const items = z.object({ data: z.array(z.unknown()), has_more: z.boolean().optional() }).parse(await this.call(`${path}/items?order=desc&limit=100`));
    const toolSchema = z.object({ type: z.string(), name: z.string().optional(), status: z.string().optional(), turn_id: z.string() });
    const tools = items.data.flatMap((item) => { const parsed = toolSchema.safeParse(item); return parsed.success && parsed.data.turn_id === turn.id ? [parsed.data] : []; });
    const messageSchema = z.object({
      type: z.literal("message"), role: z.literal("assistant"), status: z.literal("completed"),
      phase: z.literal("final_answer"), turn_id: z.literal(turn.id),
      content: z.array(z.object({ type: z.literal("output_text"), text: z.string() })),
    });
    for (const item of items.data) {
      const message = messageSchema.safeParse(item);
      if (message.success) return { ...base, state: "completed",
        output: JSON.parse(message.data.content.map((part) => part.text).join("")),
        tools: { web_search_calls: tools.filter((tool) => tool.type === "web_search_call").length,
          mcp_calls: tools.filter((tool) => tool.type === "mcp_call" && tool.name).map((tool) => ({ name: tool.name!, status: tool.status ?? "unknown" })),
          history_complete: items.has_more === false },
      };
    }
    throw new Error("agent_output_missing");
  }

  async collect(sessionId: string): Promise<AgentReport | null> {
    const progress = await this.progress(sessionId);
    if (progress.state === "running") return null;
    if (progress.state === "failed") throw new Error("agent_turn_failed");
    return { ...agentReportSchema.parse(progress.output),
      ...(progress.usage ? { observed_usage: progress.usage } : {}),
      ...(progress.tools ? { observed_tools: progress.tools } : {}),
    };
  }
}
