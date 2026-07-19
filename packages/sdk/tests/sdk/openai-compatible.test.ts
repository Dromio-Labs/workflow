import {
  afterEach,
  describe,
  expect,
  test,
} from "bun:test";

import type { EventPayload } from "@dromio/workflow/core";

import {
  parseOpenAiCompatibleSse,
  streamOpenAiCompatibleChatCompletion,
} from "@dromio/workflow/product";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenAI-compatible streaming adapter", () => {
  test("parses SSE chunks split across reads", async () => {
    const body = streamFromStrings([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hel" } }] })}\n`,
      "\n",
      `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" } }] })}\r\n\r\n`,
      "data: [DONE]\n\n",
    ]);

    const chunks = [];
    for await (const chunk of parseOpenAiCompatibleSse(body)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { choices: [{ delta: { content: "hel" } }] },
      { choices: [{ delta: { content: "lo" } }] },
    ]);
  });

  test("streams model events and returns accumulated content", async () => {
    const events: EventPayload[] = [];
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      expect(body.stream).toBe(true);
      return new Response([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "{" } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "\"ok\":true}" } }], usage: { tokens: 2 } })}\n\n`,
        "data: [DONE]\n\n",
      ].join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;

    const content = await streamOpenAiCompatibleChatCompletion({
      baseUrl: "http://localhost:1111",
      body: { messages: [], model: "test-model" },
      model: "test-model",
      onEvent(event) {
        events.push(event);
      },
      operation: "Resolve intent",
      provider: "test-provider",
      trace: {
        parentSpanId: "step:understandRequest:attempt:1",
        spanId: "model:intent:understandRequest:attempt:1",
        traceId: "run_1",
      },
    });

    expect(content).toBe("{\"ok\":true}");
    expect(events.map((event) => event.type)).toEqual([
      "model.request.started",
      "model.response.delta",
      "model.response.delta",
      "model.response.completed",
    ]);
    expect(events[0]?.trace).toMatchObject({
      parentSpanId: "step:understandRequest:attempt:1",
      spanId: "model:intent:understandRequest:attempt:1",
      traceId: "run_1",
    });
  });

  test("sends bearer authentication when an API key is configured", async () => {
    globalThis.fetch = (async (_input, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-secret");
      return new Response([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`,
        "data: [DONE]\n\n",
      ].join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;

    await expect(streamOpenAiCompatibleChatCompletion({
      apiKey: "test-secret",
      baseUrl: "http://localhost:1111",
      body: { messages: [], model: "test-model" },
      model: "test-model",
      operation: "Authenticate request",
      provider: "test-provider",
    })).resolves.toBe("ok");
  });

  test("emits a failed model event before surfacing provider errors", async () => {
    const events: EventPayload[] = [];
    globalThis.fetch = (async () =>
      new Response("offline", { status: 503 })) as unknown as typeof fetch;

    await expect(streamOpenAiCompatibleChatCompletion({
      baseUrl: "http://localhost:1111",
      body: { messages: [], model: "test-model" },
      model: "test-model",
      onEvent(event) {
        events.push(event);
      },
      operation: "Resolve intent",
      provider: "test-provider",
      setupErrorMessage: (cause) => `setup needed: ${cause}`,
      trace: {
        parentSpanId: "step:understandRequest:attempt:1",
        spanId: "model:intent:understandRequest:attempt:1",
        traceId: "run_1",
      },
    })).rejects.toThrow("setup needed: provider returned 503: offline");

    expect(events.map((event) => event.type)).toEqual([
      "model.request.started",
      "model.request.failed",
    ]);
    expect(events.at(-1)?.trace).toMatchObject({
      spanId: "model:intent:understandRequest:attempt:1",
      status: "error",
      traceId: "run_1",
    });
  });

  test("surfaces streamed provider error chunks", async () => {
    globalThis.fetch = (async () =>
      new Response([
        `data: ${JSON.stringify({ error: { code: "server_error", message: "usage limit" } })}\n\n`,
        "data: [DONE]\n\n",
      ].join(""), {
        headers: { "content-type": "text/event-stream" },
      })) as unknown as typeof fetch;

    await expect(streamOpenAiCompatibleChatCompletion({
      baseUrl: "http://localhost:1111",
      body: { messages: [], model: "test-model" },
      model: "test-model",
      operation: "Resolve intent",
      provider: "test-provider",
      setupErrorMessage: (cause) => `setup needed: ${cause}`,
    })).rejects.toThrow("setup needed: usage limit (server_error)");
  });

  test("uses explicit local chat endpoint shape when chatUrl is provided", async () => {
    const events: EventPayload[] = [];
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe("http://localhost:1234/api/v1/chat");
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input?: string;
        model?: string;
        system_prompt?: string;
      };
      expect(body).toMatchObject({
        input: "{\"task\":\"write json\"}",
        model: "google/gemma-4-26b-a4b",
        system_prompt: "Return JSON only.",
      });
      return Response.json({
        output: [
          { content: "private scratch", type: "reasoning" },
          { content: "{\"ok\":true}", type: "message" },
        ],
        stats: { total_output_tokens: 12 },
      });
    }) as typeof fetch;

    const content = await streamOpenAiCompatibleChatCompletion({
      baseUrl: "http://localhost:1234",
      body: {
        messages: [
          { content: "Return JSON only.", role: "system" },
          { content: "{\"task\":\"write json\"}", role: "user" },
        ],
        model: "local:google/gemma-4-26b-a4b",
      },
      chatUrl: "http://localhost:1234/api/v1/chat",
      model: "local:google/gemma-4-26b-a4b",
      onEvent(event) {
        events.push(event);
      },
      operation: "Resolve intent",
      provider: "local-chat",
    });

    expect(content).toBe("{\"ok\":true}");
    expect(events.map((event) => event.type)).toEqual([
      "model.request.started",
      "model.response.delta",
      "model.response.completed",
    ]);
    expect(events[1]?.detail).toMatchObject({
      delta: "{\"ok\":true}",
    });
  });
});

function streamFromStrings(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}
