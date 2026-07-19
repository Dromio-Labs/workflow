import {describe, expect, it, vi} from "vitest";

import {ChatShellManifestSchema, chatShellSchemaVersion} from "@dromio/chat-shell-ui/chat-shell-contracts/v1";

import {
  ChatShellBackendError,
  collectStreamingManifests,
  completedBackendSnapshot,
  createErrorManifestFromBackendError,
  createManifestFromProductionSnapshot,
  createMemoryIdempotencyStore,
  createProductionBackendAdapter,
  createProductionBackendTelemetryRecorder,
  emptyBackendSnapshot,
  parseBackendSseFrames,
  parseManifestEnvelope,
  parseManifestResponse,
  runIdempotentManifestMutation,
  streamingBackendSnapshot,
  toolCallCompletedBackendSnapshot,
  toolCallFailedBackendSnapshot,
  toolCallRunningBackendSnapshot,
  type BackendStreamFrame,
  type ProductionBackendObserverEvent,
} from "../../examples/production-backend-adapter";

describe("production backend adapter example", () => {
  it("validates backend snapshot and manifest response envelopes", async () => {
    const snapshotManifest = await parseManifestResponse(jsonResponse({snapshot: completedBackendSnapshot}));
    const manifestEnvelope = await parseManifestResponse(jsonResponse({
      manifest: createManifestFromProductionSnapshot(emptyBackendSnapshot),
    }));

    expect(ChatShellManifestSchema.safeParse(snapshotManifest).success).toBe(true);
    expect(snapshotManifest.runtime.conversation.state).toBe("complete");
    expect(manifestEnvelope.runtime.conversation.state).toBe("empty");
  });

  it("posts composer.submit and replaces the manifest from the backend response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(jsonResponse({snapshot: completedBackendSnapshot})));
    const adapter = createProductionBackendAdapter({
      baseUrl: "https://backend.example.test",
      fetch: fetcher,
      retry: {attempts: 0, delayMs: 0},
    });

    const manifest = await adapter.postChatShellEvent({
      payload: {attachments: [], prompt: "Summarize deployment"},
      type: "composer.submit",
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe("https://backend.example.test/api/chat-shell/events");
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      headers: {"content-type": "application/json"},
      method: "POST",
    });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      payload: {prompt: "Summarize deployment"},
      type: "composer.submit",
    });
    expect(manifest.controlPlane.threads[0].title).toBe("Deployment summary");
    expect(manifest.runtime.conversation.state).toBe("complete");
  });

  it("passes abort signals through load and event requests", async () => {
    const loadController = new AbortController();
    const eventController = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(jsonResponse({snapshot: completedBackendSnapshot})));
    const adapter = createProductionBackendAdapter({
      baseUrl: "https://backend.example.test",
      fetch: fetcher,
      retry: {attempts: 0, delayMs: 0},
    });

    await adapter.loadManifest({signal: loadController.signal});
    await adapter.postChatShellEvent({
      payload: {attachments: [], prompt: "Abort wiring"},
      type: "composer.submit",
    }, {signal: eventController.signal});

    expect(fetcher.mock.calls[0][1]?.signal).toBe(loadController.signal);
    expect(fetcher.mock.calls[1][1]?.signal).toBe(eventController.signal);
  });

  it("passes typed auth, tenant, trace, and request metadata headers through load and event requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(jsonResponse({snapshot: completedBackendSnapshot})));
    const adapter = createProductionBackendAdapter({
      baseUrl: "https://backend.example.test",
      fetch: fetcher,
      requestMetadata: {
        auth: {bearerToken: "load-secret-token"},
        headers: {"x-chat-shell-host": "design-partner"},
        requestId: "request-from-adapter",
        tenantId: "tenant-from-adapter",
        traceId: "00-adapter-trace",
      },
      retry: {attempts: 0, delayMs: 0},
    });

    await adapter.loadManifest({
      metadata: {
        requestId: "request-for-load",
        traceId: "00-load-trace",
      },
    });
    await adapter.postChatShellEvent({
      payload: {attachments: [], prompt: "Deploy"},
      type: "composer.submit",
    }, {
      idempotencyKey: "event-123",
      metadata: {
        auth: {headerValue: "Bearer post-secret-token"},
        tenantId: "tenant-for-post",
        traceId: "00-post-trace",
      },
    });

    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer load-secret-token",
      traceparent: "00-load-trace",
      "x-chat-shell-host": "design-partner",
      "x-request-id": "request-for-load",
      "x-tenant-id": "tenant-from-adapter",
    });
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
      authorization: "Bearer post-secret-token",
      "content-type": "application/json",
      "idempotency-key": "event-123",
      traceparent: "00-post-trace",
      "x-chat-shell-host": "design-partner",
      "x-request-id": "request-from-adapter",
      "x-tenant-id": "tenant-for-post",
    });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
      event: {
        payload: {prompt: "Deploy"},
        type: "composer.submit",
      },
      idempotencyKey: "event-123",
    });
  });

  it("sends idempotency keys on mutating event posts without local optimistic state", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({snapshot: completedBackendSnapshot}));
    const adapter = createProductionBackendAdapter({
      baseUrl: "https://backend.example.test",
      fetch: fetcher,
      retry: {attempts: 0, delayMs: 0},
    });

    const manifest = await adapter.postChatShellEvent({
      payload: {attachments: [], prompt: "Deploy"},
      type: "composer.submit",
    }, {idempotencyKey: "event-123"});

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      "content-type": "application/json",
      "idempotency-key": "event-123",
    });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      event: {
        payload: {prompt: "Deploy"},
        type: "composer.submit",
      },
      idempotencyKey: "event-123",
    });
    expect(manifest.runtime.conversation.state).toBe("complete");
  });

  it("replays idempotent backend mutations from the stored manifest without rerunning work", async () => {
    const store = createMemoryIdempotencyStore();
    const mutate = vi.fn()
      .mockReturnValueOnce(createManifestFromProductionSnapshot(completedBackendSnapshot))
      .mockReturnValueOnce(createManifestFromProductionSnapshot(emptyBackendSnapshot));

    const first = await runIdempotentManifestMutation({
      idempotencyKey: "event-123",
      mutate,
      store,
    });
    const replay = await runIdempotentManifestMutation({
      idempotencyKey: "event-123",
      mutate,
      store,
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
    expect(first).toMatchObject({replayed: false});
    expect(replay).toMatchObject({replayed: true});
    expect(replay.manifest.runtime.conversation.state).toBe("complete");
    expect(ChatShellManifestSchema.safeParse(replay.manifest).success).toBe(true);
  });

  it("validates cached idempotent manifests before replaying backend results", async () => {
    const mutate = vi.fn();
    const store = {
      get: vi.fn().mockResolvedValue({
        controlPlane: {},
        runtime: {conversation: {state: "complete"}},
        schemaVersion: chatShellSchemaVersion,
      }),
      set: vi.fn(),
    };

    await expect(runIdempotentManifestMutation({
      idempotencyKey: "event-invalid-cache",
      mutate,
      store,
    })).rejects.toThrow();

    expect(mutate).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it("rejects blank idempotency keys before mutating backend state", async () => {
    const mutate = vi.fn().mockReturnValue(createManifestFromProductionSnapshot(completedBackendSnapshot));

    await expect(runIdempotentManifestMutation({
      idempotencyKey: " ",
      mutate,
      store: createMemoryIdempotencyStore(),
    })).rejects.toMatchObject({
      code: "invalid_idempotency_key",
      status: 400,
    });

    expect(mutate).not.toHaveBeenCalled();
  });

  it("observes safe request correlation metadata without exposing secret header values", async () => {
    const events: ProductionBackendObserverEvent[] = [];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({snapshot: completedBackendSnapshot}));
    const adapter = createProductionBackendAdapter({
      baseUrl: "https://backend.example.test",
      fetch: fetcher,
      observe: (event) => events.push(event),
      retry: {attempts: 0, delayMs: 0},
    });

    await adapter.postChatShellEvent({
      payload: {attachments: [], prompt: "Correlate safely"},
      type: "composer.submit",
    }, {
      idempotencyKey: "event-safe-123",
      metadata: {
        auth: {bearerToken: "super-secret-token"},
        requestId: "request-123",
        tenantId: "tenant-abc",
        traceId: "00-safe-trace",
      },
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        correlation: expect.objectContaining({
          hasAuthorization: true,
          headerNames: expect.arrayContaining([
            "authorization",
            "idempotency-key",
            "traceparent",
            "x-request-id",
            "x-tenant-id",
          ]),
          idempotencyKey: "event-safe-123",
          requestId: "request-123",
          tenantId: "tenant-abc",
          traceId: "00-safe-trace",
        }),
        method: "POST",
        phase: "request:start",
      }),
    ]));
    expect(JSON.stringify(events)).not.toContain("super-secret-token");
    expect(JSON.stringify(events)).not.toContain("Bearer super-secret-token");
  });

  it("records safe telemetry summaries without storing raw auth or backend detail", async () => {
    const telemetry = createProductionBackendTelemetryRecorder();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: {
        code: "unavailable",
        detail: "Bearer super-secret-token should stay out of telemetry records",
        retryable: false,
        title: "Backend unavailable",
      },
    }, {status: 503}));
    const adapter = createProductionBackendAdapter({
      baseUrl: "https://backend.example.test",
      fetch: fetcher,
      observe: telemetry.observe,
      retry: {attempts: 0, delayMs: 0},
    });

    await expect(adapter.loadManifest({
      metadata: {
        auth: {bearerToken: "super-secret-token"},
        requestId: "request-telemetry",
        tenantId: "tenant-telemetry",
        traceId: "00-telemetry-trace",
      },
    })).rejects.toMatchObject({
      code: "unavailable",
      status: 503,
    });

    const records = telemetry.records();
    const summary = telemetry.summary();

    expect(records.map((record) => record.phase)).toEqual([
      "request:start",
      "backend:error",
      "request:error",
    ]);
    expect(records[1]).toMatchObject({
      error: {
        code: "unavailable",
        name: "ChatShellBackendError",
        retryable: false,
        status: 503,
      },
      method: "GET",
      url: "https://backend.example.test/api/chat-shell/manifest",
    });
    expect(summary).toMatchObject({
      errors: 2,
      hasAuthorization: true,
      methods: {GET: 3, POST: 0, STREAM: 0},
      phases: {
        "backend:error": 1,
        "request:error": 1,
        "request:start": 1,
      },
      requestIds: ["request-telemetry"],
      tenantIds: ["tenant-telemetry"],
      traceIds: ["00-telemetry-trace"],
    });
    expect(JSON.stringify({records, summary})).not.toContain("super-secret-token");
    expect(JSON.stringify({records, summary})).not.toContain("Bearer super-secret-token");
  });

  it("bounds telemetry records, strips URL query strings, and resets summaries", () => {
    const telemetry = createProductionBackendTelemetryRecorder({maxRecords: 2});
    const correlation = {
      hasAuthorization: false,
      headerNames: [],
      requestId: "request-bounded",
    };

    telemetry.observe({
      attempt: 0,
      correlation,
      method: "POST",
      phase: "request:start",
      url: "https://backend.example.test/api/chat-shell/events?token=url-secret#fragment",
    });
    telemetry.observe({
      attempt: 0,
      correlation,
      delayMs: 25,
      error: new Error("Bearer url-secret"),
      method: "GET",
      phase: "request:retry",
      url: "https://backend.example.test/api/chat-shell/manifest?token=url-secret",
    });
    telemetry.observe({
      correlation,
      method: "STREAM",
      phase: "stream:terminal",
      reason: "complete",
      url: "https://backend.example.test/api/chat-shell/stream?token=url-secret",
    });

    const records = telemetry.records();

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      delayMs: 25,
      error: {name: "Error"},
      method: "GET",
      phase: "request:retry",
      url: "https://backend.example.test/api/chat-shell/manifest",
    });
    expect(records[1]).toMatchObject({
      method: "STREAM",
      phase: "stream:terminal",
      reason: "complete",
      url: "https://backend.example.test/api/chat-shell/stream",
    });
    expect(telemetry.summary()).toMatchObject({
      methods: {GET: 1, POST: 0, STREAM: 1},
      retries: 1,
      total: 2,
    });
    expect(JSON.stringify(records)).not.toContain("url-secret");

    telemetry.reset();

    expect(telemetry.records()).toHaveLength(0);
    expect(telemetry.summary()).toMatchObject({total: 0});
  });

  it("retries retryable manifest loads and validates the replacement manifest", async () => {
    const backoffMs = vi.fn(() => 0);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        error: {
          code: "unavailable",
          detail: "Try again",
          retryable: true,
          title: "Backend unavailable",
        },
      }, {status: 503}))
      .mockResolvedValueOnce(jsonResponse({snapshot: streamingBackendSnapshot}));
    const adapter = createProductionBackendAdapter({
      baseUrl: "https://backend.example.test",
      fetch: fetcher,
      retry: {attempts: 1, backoffMs},
    });

    const manifest = await adapter.loadManifest();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(backoffMs).toHaveBeenCalledWith(1);
    expect(manifest.runtime.conversation.state).toBe("streaming");
    expect(ChatShellManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("observes request lifecycle, retry, backend errors, and schema errors", async () => {
    const events: ProductionBackendObserverEvent[] = [];
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        error: {
          code: "unavailable",
          detail: "Try again",
          retryable: true,
          title: "Backend unavailable",
        },
      }, {status: 503}))
      .mockResolvedValueOnce(jsonResponse({snapshot: streamingBackendSnapshot}))
      .mockResolvedValueOnce(jsonResponse({
        manifest: {
          controlPlane: {},
          runtime: {conversation: {state: "complete"}},
          schemaVersion: chatShellSchemaVersion,
        },
      }));
    const adapter = createProductionBackendAdapter({
      baseUrl: "https://backend.example.test",
      fetch: fetcher,
      observe: (event) => events.push(event),
      retry: {attempts: 1, delayMs: 0},
    });

    await adapter.loadManifest();
    await expect(adapter.postChatShellEvent({
      payload: {attachments: [], prompt: "Invalid response"},
      type: "composer.submit",
    })).rejects.toThrow();

    expect(events.map((event) => event.phase)).toEqual(expect.arrayContaining([
      "request:start",
      "backend:error",
      "request:error",
      "request:retry",
      "request:success",
      "schema:error",
    ]));
  });

  it("parses streaming snapshot and delta frames into successive full manifests", async () => {
    const frames: BackendStreamFrame[] = [
      {snapshot: streamingBackendSnapshot, type: "snapshot"},
      {
        delta: {
          appendMessages: [
            {content: "Still streaming a second chunk.", id: "message-assistant-stream-2", role: "assistant", type: "content"},
          ],
          runtimeState: "streaming",
        },
        type: "delta",
      },
      {
        delta: {
          appendMessages: [
            {content: "Final answer from backend stream.", id: "message-assistant-stream-3", role: "assistant", type: "content"},
          ],
          runtimeState: "complete",
        },
        type: "delta",
      },
    ];

    const manifests = await collectStreamingManifests(emptyBackendSnapshot, frames);

    expect(manifests).toHaveLength(3);
    expect(manifests.map((manifest) => manifest.runtime.conversation.state)).toEqual([
      "streaming",
      "streaming",
      "complete",
    ]);
    expect(manifests[2].controlPlane.messages).toHaveLength(4);
    expect(manifests.every((manifest) => ChatShellManifestSchema.safeParse(manifest).success)).toBe(true);
  });

  it("parses backend SSE stream frames from event and data fields", async () => {
    const frames: BackendStreamFrame[] = [];

    for await (const frame of parseBackendSseFrames(sseStream([
      sseEvent("snapshot", {snapshot: streamingBackendSnapshot}),
      sseEvent("terminal", {reason: "complete"}),
    ]))) {
      frames.push(frame);
    }

    expect(frames).toEqual([
      {snapshot: streamingBackendSnapshot, type: "snapshot"},
      {reason: "complete", type: "terminal"},
    ]);
  });

  it("opens SSE backend streams with metadata headers and validates manifest replacements", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(sseResponse([
      sseEvent("snapshot", {snapshot: streamingBackendSnapshot}),
      sseEvent("delta", {
        delta: {
          appendMessages: [
            {content: "SSE final answer.", id: "message-sse-final", role: "assistant", type: "content"},
          ],
          runtimeState: "complete",
        },
      }),
      sseEvent("terminal", {reason: "complete"}),
    ]));
    const adapter = createProductionBackendAdapter({
      baseUrl: "https://backend.example.test",
      fetch: fetcher,
      requestMetadata: {
        auth: {bearerToken: "stream-secret"},
        requestId: "stream-request",
        tenantId: "stream-tenant",
      },
      retry: {attempts: 0, delayMs: 0},
    });

    const manifests = await adapter.streamManifests(emptyBackendSnapshot, {
      metadata: {
        traceId: "00-stream-trace",
      },
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe("https://backend.example.test/api/chat-shell/stream");
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      accept: "text/event-stream",
      authorization: "Bearer stream-secret",
      traceparent: "00-stream-trace",
      "x-request-id": "stream-request",
      "x-tenant-id": "stream-tenant",
    });
    expect(manifests.map((manifest) => manifest.runtime.conversation.state)).toEqual([
      "streaming",
      "complete",
    ]);
    expect(manifests[1].controlPlane.messages).toHaveLength(3);
    expect(manifests.every((manifest) => ChatShellManifestSchema.safeParse(manifest).success)).toBe(true);
  });

  it("reconnects retryable backend streams and stops at terminal frames", async () => {
    const events: ProductionBackendObserverEvent[] = [];
    let opens = 0;
    async function* streamFactory() {
      opens += 1;

      if (opens === 1) {
        throw new ChatShellBackendError("Stream disconnected", {
          code: "stream_disconnected",
          retryable: true,
          status: 503,
        });
      }

      yield {
        delta: {
          appendMessages: [
            {content: "Recovered stream chunk.", id: "message-reconnected", role: "assistant", type: "content"},
          ],
          runtimeState: "streaming",
        },
        type: "delta" as const,
      };
      yield {reason: "complete", type: "terminal" as const};
      yield {
        delta: {
          appendMessages: [
            {content: "Should not be projected.", id: "message-after-terminal", role: "assistant", type: "content"},
          ],
        },
        type: "delta" as const,
      };
    }

    const manifests = await collectStreamingManifests(emptyBackendSnapshot, streamFactory, {
      observe: (event) => events.push(event),
      reconnect: {attempts: 1, delayMs: 0},
      url: "wss://backend.example.test/api/chat-shell/stream",
    });

    expect(opens).toBe(2);
    expect(manifests).toHaveLength(1);
    expect(manifests[0].controlPlane.messages).toHaveLength(1);
    expect(events.map((event) => event.phase)).toEqual(expect.arrayContaining([
      "request:retry",
      "stream:reconnect",
      "stream:terminal",
    ]));
  });

  it("honors abort signals before consuming backend streams", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(collectStreamingManifests(emptyBackendSnapshot, [], {
      signal: controller.signal,
    })).rejects.toMatchObject({name: "AbortError"});
  });

  it("turns terminal backend stream error frames into final error manifests", async () => {
    const manifests = await collectStreamingManifests(streamingBackendSnapshot, [
      {
        error: {
          code: "stream_failed",
          detail: "Worker crashed",
          title: "Stream failed",
        },
        type: "error",
      },
      {
        delta: {
          appendMessages: [
            {content: "Should not render", id: "message-after-error", role: "assistant", type: "content"},
          ],
        },
        type: "delta",
      },
    ]);

    expect(manifests).toHaveLength(1);
    expect(manifests[0].runtime.conversation).toMatchObject({
      error: {detail: "Worker crashed", title: "Stream failed"},
      state: "error",
    });
  });

  it("projects backend tool-call running, completed, and failed states into manifests", () => {
    const running = createManifestFromProductionSnapshot(toolCallRunningBackendSnapshot);
    const completed = createManifestFromProductionSnapshot(toolCallCompletedBackendSnapshot);
    const failed = createManifestFromProductionSnapshot(toolCallFailedBackendSnapshot);

    expect(running.controlPlane.toolCalls[0]).toMatchObject({status: "running", toolName: "health.check"});
    expect(completed.controlPlane.toolCalls[0].status).toBe("completed");
    expect(failed.controlPlane.toolCalls[0].status).toBe("failed");
    expect(failed.runtime.conversation).toMatchObject({
      error: {title: "Tool call failed"},
      state: "error",
    });
  });

  it("maps backend HTTP errors to typed errors and documented error manifests", async () => {
    await expect(parseManifestResponse(jsonResponse({
      error: {
        code: "rate_limited",
        detail: "Too many requests",
        retryable: false,
        title: "Rate limited",
      },
    }, {status: 429}))).rejects.toMatchObject({
      code: "rate_limited",
      retryable: false,
      status: 429,
    });

    const error = new ChatShellBackendError("Backend unavailable: deploy in progress", {
      code: "unavailable",
      retryable: true,
      status: 503,
    });
    const manifest = createErrorManifestFromBackendError(error);

    expect(manifest.runtime.conversation).toMatchObject({
      error: {
        detail: "Backend unavailable: deploy in progress",
        title: "Backend unavailable",
      },
      state: "error",
    });
  });

  it("fails validation for invalid backend responses", () => {
    expect(() => parseManifestEnvelope({
      manifest: {
        controlPlane: {},
        runtime: {conversation: {state: "complete"}},
        schemaVersion: chatShellSchemaVersion,
      },
    })).toThrow();
  });

  it("fails invalid backend stream frames and invalid stream manifests", async () => {
    await expect(collectStreamingManifests(emptyBackendSnapshot, [
      {payload: "not-a-frame"} as unknown as BackendStreamFrame,
    ])).rejects.toMatchObject({
      code: "invalid_stream_frame",
      status: 502,
    });

    await expect(collectStreamingManifests(emptyBackendSnapshot, [
      {
        snapshot: {
          ...completedBackendSnapshot,
          messages: [
            {content: "Invalid role", id: "message-invalid-role", role: "system", type: "content"},
          ],
        },
        type: "snapshot",
      } as unknown as BackendStreamFrame,
    ])).rejects.toThrow();
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: {"content-type": "application/json"},
    status: init.status ?? 200,
    ...init,
  });
}

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseResponse(events: readonly string[], init: ResponseInit = {}) {
  return new Response(sseStream(events), {
    headers: {"content-type": "text/event-stream"},
    status: init.status ?? 200,
    ...init,
  });
}

function sseStream(events: readonly string[]) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }

      controller.close();
    },
  });
}
