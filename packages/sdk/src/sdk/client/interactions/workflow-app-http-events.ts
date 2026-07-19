import type { EventRecord } from "../../core/index.js";
import type { WorkflowAppRuntime } from "./workflow-app.js";

export function filterEvents(events: EventRecord[], fromIndex?: number) {
  return fromIndex === undefined ? events : events.filter((event) => event.index >= fromIndex);
}

export function liveEventStreamResponse(events: AsyncIterable<EventRecord>): Response {
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

export async function* liveWorkflowAppEvents(
  runtime: WorkflowAppRuntime,
  runId: string,
  fromIndex = 0,
): AsyncIterable<EventRecord> {
  const seen = new Set<number>();
  const queue: EventRecord[] = [];
  let notify: (() => void) | undefined;
  const unsubscribe = runtime.subscribe(runId, (event) => {
    if (event.index < fromIndex || seen.has(event.index)) return;
    queue.push(event);
    notify?.();
    notify = undefined;
  });
  try {
    for (const event of filterEvents(runtime.getRun(runId).events, fromIndex)) {
      if (seen.has(event.index)) continue;
      seen.add(event.index);
      yield event;
      if (isTerminalEvent(event)) return;
    }
    while (!isTerminalRunStatus(runtime.getRun(runId).status)) {
      while (queue.length > 0) {
        const event = queue.shift()!;
        if (seen.has(event.index)) continue;
        seen.add(event.index);
        yield event;
        if (isTerminalEvent(event)) return;
      }
      if (isTerminalRunStatus(runtime.getRun(runId).status)) return;
      await waitForQueuedEvent();
    }
  } finally {
    unsubscribe();
  }

  function waitForQueuedEvent() {
    if (queue.length > 0 || isTerminalRunStatus(runtime.getRun(runId).status)) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      notify = resolve;
    });
  }
}

export async function* parseEventStream(response: Response): AsyncIterable<EventRecord> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const event = parseServerSentEvent(part);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    const event = parseServerSentEvent(buffer);
    if (event) yield event;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function workflowAppHttpErrorMessage(response: Response) {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

function parseServerSentEvent(part: string) {
  const data = part
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  return data ? JSON.parse(data) as EventRecord : undefined;
}

function isTerminalEvent(event: EventRecord) {
  return ["run.cancelled", "run.completed", "run.failed"].includes(event.type);
}

function isTerminalRunStatus(status: string) {
  return ["cancelled", "completed", "failed"].includes(status);
}
