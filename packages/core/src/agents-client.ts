import { z } from "zod";
import { boundedText } from "./official-source";

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  input_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative() }).optional(),
  output_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative() }).optional(),
});
export { usageSchema };
export type Usage = z.infer<typeof usageSchema>;
export interface SessionProgress {
  state: "running" | "completed" | "failed"; turn_id?: string; usage?: Usage; output?: unknown;
  tools?: { web_search_calls: number; mcp_calls: Array<{ name: string; status: string }>; history_complete: boolean };
}

/**
 * Minimal OpenAI Agents API client shared by the official sync task and the admin chat
 * assistant. The reasoning loop runs on OpenAI's side; callers only create sessions,
 * read turn progress and feed later input into the same session.
 */
export class AgentsClient {
  constructor(private readonly key: string, private readonly request: typeof fetch = fetch.bind(globalThis),
    private readonly logPrefix = "agents") {}

  async call(path: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
    const key = this.key.trim();
    if (!key || /\s/.test(key)) throw new Error("openai_key_format_invalid");
    const encodedBody = body === undefined ? undefined : JSON.stringify(body);
    console.log(JSON.stringify({ action: `${this.logPrefix}.request_ready`, operation: path === "sessions" ? "create_session" : "read_or_continue_session" }));
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
    console.log(JSON.stringify({ action: `${this.logPrefix}.openai_response`, status: response.status }));
    if (!response.ok) {
      // Only log known error identifiers. Provider messages can echo credentials or input.
      try {
        const data = JSON.parse(await boundedText(response, 32_768));
        const allowedCodes = ["invalid_api_key", "insufficient_quota", "model_not_found", "permission_denied", "invalid_value", "missing_required_parameter", "unknown_parameter", "unsupported_parameter", "invalid_json_schema"];
        const error = data?.error;
        const param = typeof error?.param === "string" && /^(?:agent|environment|input|stream|model|tools|text|format|reasoning)(?:\.[a-z_]+|\[\d+\])*$/.test(error.param) ? error.param : undefined;
        const hints = typeof error?.message === "string" ? ["json_schema", "default", "format", "uri", "required", "additionalProperties", "context_size", "source_outcomes", "Idempotency"].filter((hint) => error.message.includes(hint)) : [];
        console.error(JSON.stringify({ action: `${this.logPrefix}.openai_error`, status: response.status, hints,
          ...(allowedCodes.includes(error?.code) ? { code: error.code } : {}), ...(param ? { param } : {}) }));
      } catch { /* Keep unstructured or oversized provider bodies out of logs. */ }
      throw new Error(`openai_http_${response.status}`);
    }
    return JSON.parse(await boundedText(response));
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
        output: this.parseOutput(message.data.content.map((part) => part.text).join("")),
        tools: { web_search_calls: tools.filter((tool) => tool.type === "web_search_call").length,
          mcp_calls: tools.filter((tool) => tool.type === "mcp_call" && tool.name).map((tool) => ({ name: tool.name!, status: tool.status ?? "unknown" })),
          history_complete: items.has_more === false },
      };
    }
    throw new Error("agent_output_missing");
  }

  /** Sync constrains the model to a JSON schema; chat replies are plain text. */
  protected parseOutput(text: string): unknown {
    return JSON.parse(text);
  }
}
