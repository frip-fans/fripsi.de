import type { APIRoute } from "astro";
import { ServiceError } from "@frip-fan/core";
import { streamChat } from "../../../../../lib/chat";

/**
 * Forwards the provider's turn events to the page as SSE. Only the few shapes the dock
 * renders cross this boundary; provider payloads are never passed through verbatim.
 */
export const GET: APIRoute = async ({ locals, params, request }) => {
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(queue) {
      const send = (event: unknown) => queue.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        for await (const event of streamChat(locals.actor!, params.id!, controller.signal)) send(event);
      } catch (error) {
        const known = error instanceof ServiceError;
        send({ type: "failed", code: known ? error.code : "stream_failed", message: known ? error.message : "连接中断" });
      } finally {
        controller.abort();
        queue.close();
      }
    },
    cancel() { controller.abort(); },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      // The dock is the only consumer and it is same-origin.
      "x-accel-buffering": "no",
    },
  });
};
