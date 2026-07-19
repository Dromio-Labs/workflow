import type { EventRecord } from "../../core/loop/index.js";

export function eventStreamResponse(events: AsyncIterable<EventRecord>): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      for await (const event of events) {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.close();
    },
  }), {
    headers: {
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    },
  });
}
