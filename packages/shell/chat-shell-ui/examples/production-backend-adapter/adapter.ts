import type {ChatShellEvent} from "@dromio/chat-shell-ui";
import {
  ChatShellManifestSchema,
  type ChatShellManifest,
} from "@dromio/chat-shell-ui/chat-shell-contracts/v1";

import {
  createManifestFromProductionSnapshot,
  errorBackendSnapshot,
  type BackendMessage,
  type BackendToolCall,
  type ProductionBackendSnapshot,
} from "./backendState";

export type ProductionBackendAdapterOptions = {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly observe?: ProductionBackendObserver;
  readonly requestMetadata?: ProductionBackendRequestMetadata;
  readonly retry?: {
    readonly attempts: number;
    readonly backoffMs?: (attempt: number) => number;
    readonly delayMs?: number;
  };
};

export type ProductionBackendObserver = (event: ProductionBackendObserverEvent) => void;

export type ProductionBackendCorrelationMetadata = {
  readonly headerNames: readonly string[];
  readonly hasAuthorization: boolean;
  readonly idempotencyKey?: string;
  readonly requestId?: string;
  readonly tenantId?: string;
  readonly traceId?: string;
};

export type ProductionBackendObserverEvent =
  | {
      readonly attempt: number;
      readonly correlation: ProductionBackendCorrelationMetadata;
      readonly method: "GET" | "POST" | "STREAM";
      readonly phase: "request:start";
      readonly url: string;
    }
  | {
      readonly attempt: number;
      readonly correlation: ProductionBackendCorrelationMetadata;
      readonly method: "GET" | "POST" | "STREAM";
      readonly phase: "request:success";
      readonly url: string;
    }
  | {
      readonly attempt: number;
      readonly correlation: ProductionBackendCorrelationMetadata;
      readonly error: unknown;
      readonly method: "GET" | "POST" | "STREAM";
      readonly phase: "request:error" | "backend:error" | "schema:error";
      readonly url: string;
    }
  | {
      readonly attempt: number;
      readonly correlation: ProductionBackendCorrelationMetadata;
      readonly delayMs: number;
      readonly error: unknown;
      readonly method: "GET" | "STREAM";
      readonly phase: "request:retry";
      readonly url: string;
    }
  | {
      readonly attempt: number;
      readonly correlation: ProductionBackendCorrelationMetadata;
      readonly method: "STREAM";
      readonly phase: "stream:reconnect";
      readonly url: string;
    }
  | {
      readonly correlation: ProductionBackendCorrelationMetadata;
      readonly method: "STREAM";
      readonly phase: "stream:terminal";
      readonly reason: string;
      readonly url: string;
    };

export type ProductionBackendTelemetryError = {
  readonly code?: string;
  readonly name: string;
  readonly retryable?: boolean;
  readonly status?: number;
};

export type ProductionBackendTelemetryRecord = {
  readonly attempt?: number;
  readonly correlation: ProductionBackendCorrelationMetadata;
  readonly delayMs?: number;
  readonly error?: ProductionBackendTelemetryError;
  readonly method: ProductionBackendObserverEvent["method"];
  readonly phase: ProductionBackendObserverEvent["phase"];
  readonly reason?: string;
  readonly url: string;
};

export type ProductionBackendTelemetrySummary = {
  readonly errors: number;
  readonly hasAuthorization: boolean;
  readonly methods: Readonly<Record<ProductionBackendObserverEvent["method"], number>>;
  readonly phases: Readonly<Record<ProductionBackendObserverEvent["phase"], number>>;
  readonly requestIds: readonly string[];
  readonly retries: number;
  readonly tenantIds: readonly string[];
  readonly total: number;
  readonly traceIds: readonly string[];
};

export type ProductionBackendTelemetryRecorder = {
  readonly observe: ProductionBackendObserver;
  readonly records: () => readonly ProductionBackendTelemetryRecord[];
  readonly reset: () => void;
  readonly summary: () => ProductionBackendTelemetrySummary;
};

export type ProductionBackendRequestOptions = {
  readonly metadata?: ProductionBackendRequestMetadata;
  readonly signal?: AbortSignal;
};

export type ProductionBackendEventOptions = ProductionBackendRequestOptions & {
  readonly idempotencyKey?: string;
};

export type ProductionBackendIdempotencyStore = {
  readonly get: (idempotencyKey: string) => ChatShellManifest | Promise<ChatShellManifest | undefined> | undefined;
  readonly set: (idempotencyKey: string, manifest: ChatShellManifest) => void | Promise<void>;
};

export type ProductionBackendIdempotencyResult = {
  readonly manifest: ChatShellManifest;
  readonly replayed: boolean;
};

export type ProductionBackendRequestMetadata = {
  readonly auth?: {
    readonly bearerToken?: string;
    readonly headerValue?: string;
  };
  readonly headers?: Readonly<Record<string, string>>;
  readonly requestId?: string;
  readonly tenantId?: string;
  readonly traceId?: string;
};

export type BackendManifestEnvelope = {
  readonly manifest?: unknown;
  readonly snapshot?: ProductionBackendSnapshot;
};

export type BackendErrorEnvelope = {
  readonly error?: {
    readonly code?: string;
    readonly detail?: string;
    readonly retryable?: boolean;
    readonly title?: string;
  };
};

export type BackendStreamFrame =
  | {
      readonly snapshot: ProductionBackendSnapshot;
      readonly type: "snapshot";
    }
  | {
      readonly delta: BackendSnapshotDelta;
      readonly type: "delta";
    }
  | {
      readonly error: NonNullable<BackendErrorEnvelope["error"]>;
      readonly type: "error";
    }
  | {
      readonly reason?: string;
      readonly type: "terminal";
    };

export type BackendSnapshotDelta = {
  readonly appendMessages?: readonly BackendMessage[];
  readonly error?: ProductionBackendSnapshot["error"];
  readonly runtimeState?: ProductionBackendSnapshot["runtimeState"];
  readonly title?: string;
  readonly toolCalls?: readonly BackendToolCall[];
};

export class ChatShellBackendError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(message: string, options: {code?: string; retryable?: boolean; status: number}) {
    super(message);
    this.name = "ChatShellBackendError";
    this.code = options.code ?? "chat_shell_backend_error";
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

export function createProductionBackendAdapter(options: ProductionBackendAdapterOptions) {
  const fetcher = options.fetch;
  const retry = normalizeRetry(options.retry);

  return {
    async loadManifest(requestOptions?: AbortSignal | ProductionBackendRequestOptions): Promise<ChatShellManifest> {
      const resolvedOptions = resolveRequestOptions(requestOptions);
      const url = new URL("/api/chat-shell/manifest", options.baseUrl);
      const requestContext = createRequestContext(options.requestMetadata, resolvedOptions.metadata);

      return retryManifestLoad(async (attempt) => {
        observe(options.observe, {
          attempt,
          correlation: requestContext.correlation,
          method: "GET",
          phase: "request:start",
          url: String(url),
        });
        const response = await fetcher(url, {
          headers: requestContext.headers,
          signal: resolvedOptions.signal,
        });
        const manifest = await parseManifestResponse(response, options.observe, {
          attempt,
          correlation: requestContext.correlation,
          method: "GET",
          url: String(url),
        });
        observe(options.observe, {
          attempt,
          correlation: requestContext.correlation,
          method: "GET",
          phase: "request:success",
          url: String(url),
        });
        return manifest;
      }, retry, {
        correlation: requestContext.correlation,
        method: "GET",
        observe: options.observe,
        signal: resolvedOptions.signal,
        url: String(url),
      });
    },

    async postChatShellEvent(
      event: ChatShellEvent,
      requestOptions?: AbortSignal | ProductionBackendEventOptions,
    ): Promise<ChatShellManifest> {
      const resolvedOptions = resolveEventRequestOptions(requestOptions);
      const url = new URL("/api/chat-shell/events", options.baseUrl);
      const requestContext = createRequestContext(options.requestMetadata, resolvedOptions.metadata, {
        idempotencyKey: resolvedOptions.idempotencyKey,
      });
      const headers: Record<string, string> = {
        ...requestContext.headers,
        "content-type": "application/json",
      };
      const body = resolvedOptions.idempotencyKey
        ? {event, idempotencyKey: resolvedOptions.idempotencyKey}
        : event;

      if (resolvedOptions.idempotencyKey) {
        headers["idempotency-key"] = resolvedOptions.idempotencyKey;
      }

      observe(options.observe, {
        attempt: 0,
        correlation: requestContext.correlation,
        method: "POST",
        phase: "request:start",
        url: String(url),
      });
      let response: Response;

      try {
        response = await fetcher(url, {
          body: JSON.stringify(body),
          headers,
          method: "POST",
          signal: resolvedOptions.signal,
        });
      } catch (error) {
        observe(options.observe, {
          attempt: 0,
          correlation: requestContext.correlation,
          error,
          method: "POST",
          phase: "request:error",
          url: String(url),
        });
        throw error;
      }

      const manifest = await parseManifestResponse(response, options.observe, {
        attempt: 0,
        correlation: requestContext.correlation,
        method: "POST",
        url: String(url),
      });
      observe(options.observe, {
        attempt: 0,
        correlation: requestContext.correlation,
        method: "POST",
        phase: "request:success",
        url: String(url),
      });
      return manifest;
    },

    async streamManifests(
      initialSnapshot: ProductionBackendSnapshot,
      requestOptions?: AbortSignal | ProductionBackendRequestOptions,
    ): Promise<ChatShellManifest[]> {
      const resolvedOptions = resolveRequestOptions(requestOptions);
      const url = new URL("/api/chat-shell/stream", options.baseUrl);
      const requestContext = createRequestContext(options.requestMetadata, resolvedOptions.metadata);
      const headers: Record<string, string> = {
        ...requestContext.headers,
        accept: "text/event-stream",
      };

      return collectStreamingManifests(initialSnapshot, (attempt) => fetchBackendStreamFrames(fetcher, url, headers, {
        attempt,
        correlation: requestContext.correlation,
        method: "STREAM",
        observe: options.observe,
        signal: resolvedOptions.signal,
        url: String(url),
      }), {
        observe: options.observe,
        reconnect: retry,
        signal: resolvedOptions.signal,
        url: String(url),
      });
    },
  };
}

export function createMemoryIdempotencyStore(
  entries: Iterable<readonly [string, ChatShellManifest]> = [],
): ProductionBackendIdempotencyStore & {readonly size: number} {
  const records = new Map<string, ChatShellManifest>();

  for (const [key, manifest] of entries) {
    assertIdempotencyKey(key);
    records.set(key, cloneManifest(manifest));
  }

  return {
    get size() {
      return records.size;
    },
    get(idempotencyKey) {
      assertIdempotencyKey(idempotencyKey);
      const manifest = records.get(idempotencyKey);

      return manifest ? cloneManifest(manifest) : undefined;
    },
    set(idempotencyKey, manifest) {
      assertIdempotencyKey(idempotencyKey);
      records.set(idempotencyKey, cloneManifest(manifest));
    },
  };
}

export async function runIdempotentManifestMutation(options: {
  readonly idempotencyKey?: string;
  readonly mutate: () => ChatShellManifest | Promise<ChatShellManifest>;
  readonly store?: ProductionBackendIdempotencyStore;
}): Promise<ProductionBackendIdempotencyResult> {
  const idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey);

  if (idempotencyKey && options.store) {
    const cachedManifest = await options.store.get(idempotencyKey);

    if (cachedManifest) {
      return {
        manifest: cloneManifest(cachedManifest),
        replayed: true,
      };
    }
  }

  const manifest = cloneManifest(await options.mutate());

  if (idempotencyKey && options.store) {
    await options.store.set(idempotencyKey, manifest);
  }

  return {
    manifest,
    replayed: false,
  };
}

export function createProductionBackendTelemetryRecorder(options: {
  readonly maxRecords?: number;
} = {}): ProductionBackendTelemetryRecorder {
  const records: ProductionBackendTelemetryRecord[] = [];

  return {
    observe(event) {
      records.push(createTelemetryRecord(event));

      if (options.maxRecords && records.length > options.maxRecords) {
        records.splice(0, records.length - options.maxRecords);
      }
    },
    records() {
      return records.map((record) => ({
        ...record,
        correlation: {
          ...record.correlation,
          headerNames: [...record.correlation.headerNames],
        },
      }));
    },
    reset() {
      records.splice(0);
    },
    summary() {
      return summarizeTelemetryRecords(records);
    },
  };
}

export async function parseManifestResponse(
  response: Response,
  observe?: ProductionBackendObserver,
  context?: {attempt: number; correlation: ProductionBackendCorrelationMetadata; method: "GET" | "POST" | "STREAM"; url: string},
): Promise<ChatShellManifest> {
  const body: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = createBackendError(response.status, body);
    observeError(observe, context, "backend:error", error);
    throw error;
  }

  try {
    return parseManifestEnvelope(body);
  } catch (error) {
    observeError(observe, context, "schema:error", error);
    throw error;
  }
}

export function parseManifestEnvelope(body: unknown): ChatShellManifest {
  const envelope = body as BackendManifestEnvelope;

  if (envelope && typeof envelope === "object" && "snapshot" in envelope && envelope.snapshot) {
    return createManifestFromProductionSnapshot(envelope.snapshot);
  }

  if (envelope && typeof envelope === "object" && "manifest" in envelope) {
    return ChatShellManifestSchema.parse(envelope.manifest);
  }

  return ChatShellManifestSchema.parse(body);
}

export async function* parseBackendSseFrames(
  stream: ReadableStream<Uint8Array>,
  options: {readonly signal?: AbortSignal} = {},
): AsyncIterable<BackendStreamFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      throwIfAborted(options.signal);
      const {done, value} = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, {stream: true});
      yield* drainSseEventBuffer(buffer, (nextBuffer) => {
        buffer = nextBuffer;
      });
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      const frame = parseSseEventBlock(buffer);

      if (frame) {
        yield frame;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function collectStreamingManifests(
  initialSnapshot: ProductionBackendSnapshot,
  frames: AsyncIterable<BackendStreamFrame> | Iterable<BackendStreamFrame> | ((attempt: number) => AsyncIterable<BackendStreamFrame> | Iterable<BackendStreamFrame>),
  options: {
    readonly observe?: ProductionBackendObserver;
    readonly reconnect?: {readonly attempts: number; readonly backoffMs?: (attempt: number) => number; readonly delayMs?: number};
    readonly signal?: AbortSignal;
    readonly url?: string;
  } = {},
): Promise<ChatShellManifest[]> {
  let snapshot = structuredClone(initialSnapshot);
  const manifests: ChatShellManifest[] = [];
  const reconnect = normalizeRetry(options.reconnect);
  const url = options.url ?? "backend-stream";
  const correlation = createCorrelationMetadata();

  for (let attempt = 0; attempt <= reconnect.attempts; attempt += 1) {
    throwIfAborted(options.signal);
    observe(options.observe, {attempt, correlation, method: "STREAM", phase: "request:start", url});

    try {
      const source = typeof frames === "function" ? frames(attempt) : frames;

      for await (const rawFrame of source) {
        throwIfAborted(options.signal);
        const frame = assertBackendStreamFrame(rawFrame);

        if (frame.type === "terminal") {
          observe(options.observe, {
            correlation,
            method: "STREAM",
            phase: "stream:terminal",
            reason: frame.reason ?? "backend stream completed",
            url,
          });
          observe(options.observe, {attempt, correlation, method: "STREAM", phase: "request:success", url});
          return manifests;
        }

        if (frame.type === "snapshot") {
          snapshot = structuredClone(frame.snapshot);
        } else if (frame.type === "delta") {
          snapshot = applySnapshotDelta(snapshot, frame.delta);
        } else {
          snapshot = {
            ...snapshot,
            error: {
              detail: frame.error.detail ?? "The backend stream failed.",
              title: frame.error.title ?? "Backend stream failed",
            },
            runtimeState: "error",
          };
          manifests.push(createManifestFromProductionSnapshot(snapshot));
          observe(options.observe, {
            correlation,
            method: "STREAM",
            phase: "stream:terminal",
            reason: frame.error.code ?? "backend stream error",
            url,
          });
          return manifests;
        }

        try {
          manifests.push(createManifestFromProductionSnapshot(snapshot));
        } catch (error) {
          observeError(options.observe, {attempt, correlation, method: "STREAM", url}, "schema:error", error);
          throw error;
        }
      }

      observe(options.observe, {attempt, correlation, method: "STREAM", phase: "request:success", url});
      return manifests;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      observe(options.observe, {attempt, correlation, error, method: "STREAM", phase: "request:error", url});

      if (!(error instanceof ChatShellBackendError) || !error.retryable || attempt === reconnect.attempts) {
        throw error;
      }

      const delayMs = reconnect.backoffMs(attempt + 1);
      observe(options.observe, {attempt, correlation, delayMs, error, method: "STREAM", phase: "request:retry", url});
      await abortableDelay(delayMs, options.signal);
      observe(options.observe, {attempt: attempt + 1, correlation, method: "STREAM", phase: "stream:reconnect", url});
    }
  }

  return manifests;
}

export function applySnapshotDelta(
  snapshot: ProductionBackendSnapshot,
  delta: BackendSnapshotDelta,
): ProductionBackendSnapshot {
  return {
    ...snapshot,
    error: delta.error ?? snapshot.error,
    messages: [...snapshot.messages, ...(delta.appendMessages ?? [])],
    runtimeState: delta.runtimeState ?? snapshot.runtimeState,
    title: delta.title ?? snapshot.title,
    toolCalls: delta.toolCalls ? [...delta.toolCalls] : snapshot.toolCalls,
  };
}

export function createErrorManifestFromBackendError(error: ChatShellBackendError): ChatShellManifest {
  return createManifestFromProductionSnapshot({
    ...errorBackendSnapshot,
    error: {
      detail: error.message,
      title: error.status >= 500 ? "Backend unavailable" : "Backend request rejected",
    },
    runtimeState: "error",
  });
}

async function retryManifestLoad(
  load: (attempt: number) => Promise<ChatShellManifest>,
  retry: NormalizedRetryPolicy,
  context: {
    readonly correlation: ProductionBackendCorrelationMetadata;
    readonly method: "GET";
    readonly observe?: ProductionBackendObserver;
    readonly signal?: AbortSignal;
    readonly url: string;
  },
): Promise<ChatShellManifest> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retry.attempts; attempt += 1) {
    try {
      throwIfAborted(context.signal);
      return await load(attempt);
    } catch (error) {
      lastError = error;
      observe(context.observe, {
        attempt,
        correlation: context.correlation,
        error,
        method: context.method,
        phase: "request:error",
        url: context.url,
      });

      if (isAbortError(error) || !(error instanceof ChatShellBackendError) || !error.retryable || attempt === retry.attempts) {
        throw error;
      }

      const delayMs = retry.backoffMs(attempt + 1);
      observe(context.observe, {
        attempt,
        correlation: context.correlation,
        delayMs,
        error,
        method: context.method,
        phase: "request:retry",
        url: context.url,
      });
      await abortableDelay(delayMs, context.signal);
    }
  }

  throw lastError;
}

function createBackendError(status: number, body: unknown): ChatShellBackendError {
  const envelope = body as BackendErrorEnvelope;
  const backendError = envelope && typeof envelope === "object" ? envelope.error : undefined;
  const title = backendError?.title ?? `ChatShell backend failed with HTTP ${status}`;
  const detail = backendError?.detail ? `: ${backendError.detail}` : "";

  return new ChatShellBackendError(`${title}${detail}`, {
    code: backendError?.code,
    retryable: backendError?.retryable ?? status >= 500,
    status,
  });
}

function cloneManifest(manifest: ChatShellManifest): ChatShellManifest {
  return ChatShellManifestSchema.parse(structuredClone(manifest));
}

function normalizeIdempotencyKey(idempotencyKey?: string): string | undefined {
  if (idempotencyKey === undefined) {
    return undefined;
  }

  const trimmed = idempotencyKey.trim();
  assertIdempotencyKey(trimmed);

  return trimmed;
}

function assertIdempotencyKey(idempotencyKey: string) {
  if (!idempotencyKey.trim()) {
    throw new ChatShellBackendError("Idempotency keys must be non-empty strings.", {
      code: "invalid_idempotency_key",
      retryable: false,
      status: 400,
    });
  }
}

function createTelemetryRecord(event: ProductionBackendObserverEvent): ProductionBackendTelemetryRecord {
  return {
    attempt: "attempt" in event ? event.attempt : undefined,
    correlation: {
      ...event.correlation,
      headerNames: [...event.correlation.headerNames],
    },
    delayMs: "delayMs" in event ? event.delayMs : undefined,
    error: "error" in event ? describeTelemetryError(event.error) : undefined,
    method: event.method,
    phase: event.phase,
    reason: "reason" in event ? event.reason : undefined,
    url: sanitizeTelemetryUrl(event.url),
  };
}

function describeTelemetryError(error: unknown): ProductionBackendTelemetryError {
  if (error instanceof ChatShellBackendError) {
    return {
      code: error.code,
      name: error.name,
      retryable: error.retryable,
      status: error.status,
    };
  }

  if (error instanceof Error) {
    return {name: error.name};
  }

  return {name: typeof error};
}

function sanitizeTelemetryUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/, 1)[0];
  }
}

function summarizeTelemetryRecords(records: readonly ProductionBackendTelemetryRecord[]): ProductionBackendTelemetrySummary {
  const methods = {
    GET: 0,
    POST: 0,
    STREAM: 0,
  } satisfies Record<ProductionBackendObserverEvent["method"], number>;
  const phases = {
    "backend:error": 0,
    "request:error": 0,
    "request:retry": 0,
    "request:start": 0,
    "request:success": 0,
    "schema:error": 0,
    "stream:reconnect": 0,
    "stream:terminal": 0,
  } satisfies Record<ProductionBackendObserverEvent["phase"], number>;
  const requestIds = new Set<string>();
  const tenantIds = new Set<string>();
  const traceIds = new Set<string>();
  let errors = 0;
  let hasAuthorization = false;
  let retries = 0;

  for (const record of records) {
    methods[record.method] += 1;
    phases[record.phase] += 1;
    hasAuthorization = hasAuthorization || record.correlation.hasAuthorization;

    if (record.correlation.requestId) {
      requestIds.add(record.correlation.requestId);
    }

    if (record.correlation.tenantId) {
      tenantIds.add(record.correlation.tenantId);
    }

    if (record.correlation.traceId) {
      traceIds.add(record.correlation.traceId);
    }

    if (record.error) {
      errors += 1;
    }

    if (record.phase === "request:retry" || record.phase === "stream:reconnect") {
      retries += 1;
    }
  }

  return {
    errors,
    hasAuthorization,
    methods,
    phases,
    requestIds: [...requestIds],
    retries,
    tenantIds: [...tenantIds],
    total: records.length,
    traceIds: [...traceIds],
  };
}

type NormalizedRetryPolicy = {
  readonly attempts: number;
  readonly backoffMs: (attempt: number) => number;
};

function normalizeRetry(
  retry?: {readonly attempts: number; readonly backoffMs?: (attempt: number) => number; readonly delayMs?: number},
): NormalizedRetryPolicy {
  return {
    attempts: retry?.attempts ?? 2,
    backoffMs: retry?.backoffMs ?? (() => retry?.delayMs ?? 0),
  };
}

function resolveRequestOptions(requestOptions?: AbortSignal | ProductionBackendRequestOptions): ProductionBackendRequestOptions {
  return requestOptions instanceof AbortSignal ? {signal: requestOptions} : requestOptions ?? {};
}

function resolveEventRequestOptions(requestOptions?: AbortSignal | ProductionBackendEventOptions): ProductionBackendEventOptions {
  return requestOptions instanceof AbortSignal ? {signal: requestOptions} : requestOptions ?? {};
}

function createRequestContext(
  adapterMetadata?: ProductionBackendRequestMetadata,
  requestMetadata?: ProductionBackendRequestMetadata,
  options: {readonly idempotencyKey?: string} = {},
): {
  readonly correlation: ProductionBackendCorrelationMetadata;
  readonly headers: Record<string, string>;
} {
  const metadata = mergeRequestMetadata(adapterMetadata, requestMetadata);
  const headers = buildRequestHeaders(metadata);

  return {
    correlation: createCorrelationMetadata(metadata, headers, options.idempotencyKey),
    headers,
  };
}

function mergeRequestMetadata(
  adapterMetadata?: ProductionBackendRequestMetadata,
  requestMetadata?: ProductionBackendRequestMetadata,
): ProductionBackendRequestMetadata {
  return {
    ...adapterMetadata,
    ...requestMetadata,
    auth: requestMetadata?.auth ?? adapterMetadata?.auth,
    headers: {
      ...(adapterMetadata?.headers ?? {}),
      ...(requestMetadata?.headers ?? {}),
    },
  };
}

function buildRequestHeaders(metadata?: ProductionBackendRequestMetadata): Record<string, string> {
  const headers: Record<string, string> = {...(metadata?.headers ?? {})};

  if (metadata?.auth?.headerValue) {
    headers.authorization = metadata.auth.headerValue;
  } else if (metadata?.auth?.bearerToken) {
    headers.authorization = `Bearer ${metadata.auth.bearerToken}`;
  }

  if (metadata?.tenantId) {
    headers["x-tenant-id"] = metadata.tenantId;
  }

  if (metadata?.traceId) {
    headers["traceparent"] = metadata.traceId;
  }

  if (metadata?.requestId) {
    headers["x-request-id"] = metadata.requestId;
  }

  return headers;
}

function createCorrelationMetadata(
  metadata?: ProductionBackendRequestMetadata,
  headers: Record<string, string> = {},
  idempotencyKey?: string,
): ProductionBackendCorrelationMetadata {
  const normalizedHeaderNames = [
    ...Object.keys(headers),
    ...(idempotencyKey ? ["idempotency-key"] : []),
  ].map((name) => name.toLowerCase()).sort();

  return {
    headerNames: [...new Set(normalizedHeaderNames)],
    hasAuthorization: normalizedHeaderNames.includes("authorization"),
    idempotencyKey,
    requestId: metadata?.requestId,
    tenantId: metadata?.tenantId,
    traceId: metadata?.traceId,
  };
}

function observe(observe: ProductionBackendObserver | undefined, event: ProductionBackendObserverEvent) {
  observe?.(event);
}

function observeError(
  observe: ProductionBackendObserver | undefined,
  context: {attempt: number; correlation: ProductionBackendCorrelationMetadata; method: "GET" | "POST" | "STREAM"; url: string} | undefined,
  phase: "backend:error" | "schema:error",
  error: unknown,
) {
  if (!context) {
    return;
  }

  observe?.({...context, error, phase});
}

async function* fetchBackendStreamFrames(
  fetcher: typeof fetch,
  url: URL,
  headers: Record<string, string>,
  context: {
    readonly attempt: number;
    readonly correlation: ProductionBackendCorrelationMetadata;
    readonly method: "STREAM";
    readonly observe?: ProductionBackendObserver;
    readonly signal?: AbortSignal;
    readonly url: string;
  },
): AsyncIterable<BackendStreamFrame> {
  const response = await fetcher(url, {
    headers,
    signal: context.signal,
  });

  if (!response.ok) {
    const error = createBackendError(response.status, await readJsonOrEmpty(response));
    observeError(context.observe, context, "backend:error", error);
    throw error;
  }

  if (!response.body) {
    throw new ChatShellBackendError("Backend stream response did not include a readable body.", {
      code: "missing_stream_body",
      retryable: true,
      status: response.status || 502,
    });
  }

  yield* parseBackendSseFrames(response.body, {signal: context.signal});
}

async function readJsonOrEmpty(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

function assertBackendStreamFrame(frame: unknown): BackendStreamFrame {
  if (!frame || typeof frame !== "object" || !("type" in frame)) {
    throw new ChatShellBackendError("Backend stream emitted an invalid frame.", {
      code: "invalid_stream_frame",
      retryable: false,
      status: 502,
    });
  }

  if (frame.type === "snapshot" || frame.type === "delta" || frame.type === "error" || frame.type === "terminal") {
    return frame as BackendStreamFrame;
  }

  throw new ChatShellBackendError(`Backend stream emitted unknown frame type "${String(frame.type)}".`, {
    code: "invalid_stream_frame",
    retryable: false,
    status: 502,
  });
}

function* drainSseEventBuffer(
  buffer: string,
  setBuffer: (buffer: string) => void,
): Iterable<BackendStreamFrame> {
  let remaining = buffer;
  let boundary = findSseEventBoundary(remaining);

  while (boundary) {
    const block = remaining.slice(0, boundary.index);
    remaining = remaining.slice(boundary.nextIndex);
    const frame = parseSseEventBlock(block);

    if (frame) {
      yield frame;
    }

    boundary = findSseEventBoundary(remaining);
  }

  setBuffer(remaining);
}

function findSseEventBoundary(buffer: string): {index: number; nextIndex: number} | undefined {
  const lfIndex = buffer.indexOf("\n\n");
  const crlfIndex = buffer.indexOf("\r\n\r\n");

  if (lfIndex === -1 && crlfIndex === -1) {
    return undefined;
  }

  if (lfIndex === -1 || (crlfIndex !== -1 && crlfIndex < lfIndex)) {
    return {index: crlfIndex, nextIndex: crlfIndex + 4};
  }

  return {index: lfIndex, nextIndex: lfIndex + 2};
}

function parseSseEventBlock(block: string): BackendStreamFrame | undefined {
  const data: string[] = [];
  let eventType: string | undefined;

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) {
      continue;
    }

    const separatorIndex = rawLine.indexOf(":");
    const field = separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? "" : rawLine.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") {
      eventType = value;
    }

    if (field === "data") {
      data.push(value);
    }
  }

  if (data.length === 0) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(data.join("\n"));
  } catch (error) {
    throw new ChatShellBackendError("Backend SSE stream emitted non-JSON data.", {
      code: "invalid_stream_frame",
      retryable: false,
      status: 502,
    });
  }

  const frame = eventType && parsed && typeof parsed === "object" && !("type" in parsed)
    ? {...parsed, type: eventType}
    : parsed;

  return assertBackendStreamFrame(frame);
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(resolve, delayMs);

    signal?.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      reject(createAbortError());
    }, {once: true});
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function createAbortError() {
  return new DOMException("The ChatShell backend request was aborted.", "AbortError");
}
