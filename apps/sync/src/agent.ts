import { AgentsClient as AgentsClientBase, usageSchema } from "@frip-fan/core";
import { z } from "zod";

export const agentReportSchema = z.object({
  summary: z.string().max(2000),
  published_change_ids: z.array(z.string()).max(20),
  review_change_ids: z.array(z.string()).max(20),
  notes: z.array(z.string().max(1000)).max(20),
  source_outcomes: z.array(z.object({ source_url: z.url(), decision: z.enum(["published", "proposed", "unchanged", "ignored", "review"]), reason: z.string().max(500) })).max(30).default([]),
});
export type { Usage, SessionProgress } from "@frip-fan/core";
import type { SessionProgress } from "@frip-fan/core";
export type AgentReport = z.infer<typeof agentReportSchema> & {
  observed_usage?: z.infer<typeof usageSchema>;
  observed_tools?: { web_search_calls: number; mcp_calls: Array<{ name: string; status: string }>; history_complete: boolean };
};

export { instructions } from "./prompt";
import { instructions } from "./prompt";

export class AgentsClient extends AgentsClientBase {
  constructor(key: string, request: typeof fetch = fetch.bind(globalThis)) {
    super(key, request, "official_sync");
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
