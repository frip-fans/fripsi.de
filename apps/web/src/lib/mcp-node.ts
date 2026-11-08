import worker from "@frip-fan/mcp";
import { getEnv } from "./env";
export function handleMcp(request: Request): Promise<Response> {
  return worker.fetch(request, getEnv(), {
    waitUntil(promise: Promise<unknown>) { void promise.catch(() => console.error("MCP background task failed")); },
    passThroughOnException() {}, props: {},
  } as ExecutionContext);
}
