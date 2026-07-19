import type {
  EventRecord,
} from "../../core/index.js";
import {
  json,
} from "../../shared/transport/serialization.js";
import type {
  TriggerJobEvent,
} from "../types.js";

export function eventStreamResponse(events: AsyncIterable<EventRecord | TriggerJobEvent>): Response {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  return new Response(new ReadableStream<Uint8Array>({
    async cancel() {
      await iterator.return?.();
    },
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(
        encoder.encode(`event: ${next.value.type}\ndata: ${JSON.stringify(next.value)}\n\n`),
      );
    },
  }), {
    headers: {
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    },
  });
}

export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function jsonErrorResponse(request: Request, code: string, message: string, status: number): Response {
  return json({
    error: {
      code,
      message,
      requestId: request.headers.get("x-request-id") ?? `req_${Date.now().toString(36)}`,
    },
  }, status);
}

export function safeHttpEnvelope(request: Request) {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (["authorization", "cookie", "set-cookie"].includes(key.toLowerCase())) return;
    if (value.length > 500) return;
    headers[key.toLowerCase()] = value;
  });
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams) {
    const existing = query[key];
    if (existing === undefined) query[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else query[key] = [existing, value];
  }
  return {
    headers,
    method: request.method,
    path: url.pathname,
    query,
    receivedAt: new Date().toISOString(),
  };
}
