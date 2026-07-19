import type { WorkflowEvent } from "./workflow.types.js";

export class EventQueue implements AsyncIterable<WorkflowEvent> {
  private readonly pending: WorkflowEvent[] = [];
  private readonly readers: Array<(result: IteratorResult<WorkflowEvent>) => void> = [];
  private readonly seenIndexes = new Set<number>();
  private closed = false;

  constructor(private readonly fromIndex = 0) {}

  [Symbol.asyncIterator]() {
    return this;
  }

  next(): Promise<IteratorResult<WorkflowEvent>> {
    const value = this.pending.shift();
    if (value) {
      return Promise.resolve({ done: false, value });
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => {
      this.readers.push(resolve);
    });
  }

  push(event: WorkflowEvent) {
    if (event.index < this.fromIndex) {
      return;
    }
    if (this.seenIndexes.has(event.index)) {
      return;
    }
    this.seenIndexes.add(event.index);
    const reader = this.readers.shift();
    if (reader) {
      reader({ done: false, value: event });
      return;
    }
    this.pending.push(event);
  }

  pushMany(events: WorkflowEvent[]) {
    for (const event of events) {
      this.push(event);
    }
  }

  close() {
    this.closed = true;
    for (const reader of this.readers.splice(0)) {
      reader({ done: true, value: undefined });
    }
  }
}

export function eventStreamResponse(events: AsyncIterable<WorkflowEvent>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const event of events) {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    },
  });
}
