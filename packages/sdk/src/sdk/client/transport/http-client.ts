import type { EventRecord } from "../../core/loop/index.js";
import type {
  WorkflowRunArtifactRef,
  RuntimeActionResult,
  RuntimeRerunInput,
  RuntimeSessionSnapshot,
} from "../../core/runtime/index.js";
import type {
  ArtifactUploadInput,
  CreateIntentClientInput,
  IntentClient,
  IntentClientFetch,
} from "./client.types.js";

type JsonRecord = Record<string, unknown>;

export function createHttpClient(input: Extract<CreateIntentClientInput, { baseUrl: string }>): IntentClient {
  const fetcher = input.fetch ?? fetch;
  const request = async <T>(path: string, init: RequestInit = {}) => {
    const response = await fetcher(new Request(url(input.baseUrl, path), {
      ...init,
      headers: await mergeHeaders(input.headers, init.headers),
    }));
    if (!response.ok) {
      throw new Error(await errorMessage(response));
    }
    return response.json() as Promise<T>;
  };

  return {
    artifacts: {
      async upload(uploadInput) {
        const init = artifactUploadInit(uploadInput);
        const response = await fetcher(new Request(url(input.baseUrl, "/artifacts"), {
          ...init,
          headers: await mergeHeaders(input.headers, init.headers),
        }));
        if (!response.ok) throw new Error(await errorMessage(response));
        return response.json() as Promise<WorkflowRunArtifactRef>;
      },
      url(artifactId) {
        return url(input.baseUrl, `/artifacts/${encodeURIComponent(artifactId)}`);
      },
    },
    hooks: {
      async resume(body) {
        const data = await request<{ session: RuntimeSessionSnapshot }>(
          `/hooks/${encodeURIComponent(body.token)}/resume`,
          jsonInit("POST", { value: body.value }),
        );
        return data.session;
      },
    },
    runs: {
      async create(body) {
        return request<{ session: RuntimeSessionSnapshot }>(
          `/workflows/${encodeURIComponent(body.workflow)}/runs`,
          jsonInit("POST", {
            answers: body.answers,
            input: body.input,
            runId: body.runId,
          }),
        );
      },
    },
    sessions: {
      async actions(sessionId) {
        const data = await request<{ actions: IntentClient["sessions"]["actions"] extends (sessionId: string) => Promise<infer T> ? T : never }>(
          `/sessions/${encodeURIComponent(sessionId)}/actions`,
        );
        return data.actions;
      },
      async applyAction(body) {
        return request<RuntimeActionResult>(
          `/sessions/${encodeURIComponent(body.sessionId)}/actions/${encodeURIComponent(body.actionKey)}`,
          jsonInit("POST", { input: body.input }),
        );
      },
      async checkpoints(sessionId) {
        const data = await request<{ checkpoints: Awaited<ReturnType<IntentClient["sessions"]["checkpoints"]>> }>(
          `/sessions/${encodeURIComponent(sessionId)}/checkpoints`,
        );
        return data.checkpoints;
      },
      async events(sessionId, body = {}) {
        const data = await request<{ events: EventRecord[] }>(
          withQuery(`/sessions/${encodeURIComponent(sessionId)}/events`, body),
        );
        return data.events;
      },
      async get(sessionId) {
        const data = await request<{ session: RuntimeSessionSnapshot }>(
          `/sessions/${encodeURIComponent(sessionId)}`,
        );
        return data.session;
      },
      async list() {
        const data = await request<{ sessions: RuntimeSessionSnapshot[] }>("/sessions");
        return data.sessions;
      },
      async rerun(body: RuntimeRerunInput) {
        const data = await request<{ session: RuntimeSessionSnapshot }>(
          `/sessions/${encodeURIComponent(body.sessionId)}/reruns`,
          jsonInit("POST", {
            checkpointId: body.checkpointId,
            input: body.input,
            state: body.state,
          }),
        );
        return data.session;
      },
      async *streamEvents(sessionId, body = {}) {
        const response = await fetcher(new Request(url(
          input.baseUrl,
          withQuery(`/sessions/${encodeURIComponent(sessionId)}/events/stream`, body),
        ), {
          headers: await headers(input.headers),
        }));
        if (!response.ok) {
          throw new Error(await errorMessage(response));
        }
        yield* parseEventStream(response);
      },
    },
    workflows: {
      async list() {
        const data = await request<{ workflows: Awaited<ReturnType<IntentClient["workflows"]["list"]>> }>("/workflows");
        return data.workflows;
      },
    },
  };
}

function artifactUploadInit(input: ArtifactUploadInput): RequestInit {
  if (input.file) {
    const body = new FormData();
    const fileName = input.title ?? fileNameFromBlob(input.file);
    if (fileName) body.append("file", input.file, fileName);
    else body.append("file", input.file);
    const uploadHeaders = new Headers();
    if (input.kind) uploadHeaders.set("x-dromio-artifact-kind", input.kind);
    return { body, headers: uploadHeaders, method: "POST" };
  }
  const bytes = new Uint8Array(input.bytes.byteLength);
  bytes.set(input.bytes);
  const uploadHeaders = new Headers({
    "content-type": input.mediaType,
    "x-dromio-artifact-kind": input.kind,
  });
  if (input.title) uploadHeaders.set("x-dromio-artifact-title", input.title);
  return { body: bytes.buffer, headers: uploadHeaders, method: "POST" };
}

function fileNameFromBlob(value: Blob): string | undefined {
  return "name" in value && typeof value.name === "string" ? value.name : undefined;
}

async function* parseEventStream(response: Response): AsyncIterable<EventRecord> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const data = part
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");
      if (data) yield JSON.parse(data) as EventRecord;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const data = buffer
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (data) yield JSON.parse(data) as EventRecord;
  }
}

function jsonInit(method: "POST", body: JsonRecord): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  };
}

function withQuery(path: string, input: { fromIndex?: number }) {
  if (input.fromIndex === undefined) return path;
  return `${path}?fromIndex=${encodeURIComponent(String(input.fromIndex))}`;
}

async function headers(input: Extract<CreateIntentClientInput, { baseUrl: string }>["headers"]) {
  return typeof input === "function" ? await input() : input ?? {};
}

async function mergeHeaders(
  base: Extract<CreateIntentClientInput, { baseUrl: string }>["headers"],
  extension?: HeadersInit,
): Promise<Headers> {
  const merged = new Headers(await headers(base));
  new Headers(extension).forEach((value, key) => merged.set(key, value));
  return merged;
}

function url(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function errorMessage(response: Response) {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
