import type {
  EventRecord,
} from "../../core/index.js";
import {
  json,
  jsonError,
  objectBody,
  readJson,
} from "../../shared/transport/serialization.js";
import {
  snapshotWorkflowAppRun,
  type WorkflowAppInputAttachment,
  type WorkflowAppResumeHookInput,
  type WorkflowAppRunSnapshot,
  type WorkflowAppRuntime,
  type WorkflowAppStartRunInput,
  type WorkflowAppWorkflowDescriptor,
} from "./workflow-app.js";
import {
  filterEvents,
  liveEventStreamResponse,
  liveWorkflowAppEvents,
  parseEventStream,
  workflowAppHttpErrorMessage,
} from "./workflow-app-http-events.js";

export type CreateWorkflowAppHttpAdapterInput = {
  basePath?: string;
  runtime: WorkflowAppRuntime;
};

export type WorkflowAppHttpRouteParams = {
  questionId?: string;
  runId?: string;
  token?: string;
  workflowId?: string;
};

export type WorkflowAppHttpRouteHandler = (
  request: Request,
  params?: WorkflowAppHttpRouteParams,
) => Promise<Response> | Response;

export type WorkflowAppHttpRoutes = {
  answerQuestion: WorkflowAppHttpRouteHandler;
  getRun: WorkflowAppHttpRouteHandler;
  listEvents: WorkflowAppHttpRouteHandler;
  listRuns: WorkflowAppHttpRouteHandler;
  listWorkflows: WorkflowAppHttpRouteHandler;
  resumeHook: WorkflowAppHttpRouteHandler;
  resumeRun: WorkflowAppHttpRouteHandler;
  startRun: WorkflowAppHttpRouteHandler;
  streamEvents: WorkflowAppHttpRouteHandler;
};

export type WorkflowAppHttpAdapter = {
  fetch(request: Request): Promise<Response>;
  routes: WorkflowAppHttpRoutes;
};

export type WorkflowAppRunResponse = {
  run: WorkflowAppRunSnapshot;
};

export type WorkflowAppClient = {
  hooks: {
    resume(input: WorkflowAppResumeHookInput): Promise<WorkflowAppRunSnapshot>;
  };
  runs: {
    answerQuestion(runId: string, input: { questionId: string; value: unknown }): Promise<WorkflowAppRunSnapshot>;
    create(input: WorkflowAppStartRunInput): Promise<WorkflowAppRunSnapshot>;
    events(runId: string, input?: { fromIndex?: number }): Promise<EventRecord[]>;
    get(runId: string): Promise<WorkflowAppRunSnapshot>;
    list(): Promise<WorkflowAppRunSnapshot[]>;
    resume(runId: string): Promise<WorkflowAppRunSnapshot>;
    streamEvents(runId: string, input?: { fromIndex?: number }): AsyncIterable<EventRecord>;
  };
  workflows: {
    list(): Promise<WorkflowAppWorkflowDescriptor[]>;
  };
};

export type CreateWorkflowAppClientInput =
  | {
      runtime: WorkflowAppRuntime;
    }
  | {
      baseUrl: string;
      fetch?: (request: Request) => Promise<Response> | Response;
    };

type WorkflowAppHttpMatch = {
  handler: keyof WorkflowAppHttpRoutes;
  params?: WorkflowAppHttpRouteParams;
};

export function createWorkflowAppHttpRoutes(input: CreateWorkflowAppHttpAdapterInput): WorkflowAppHttpRoutes {
  const snapshot = (runId: string) => snapshotWorkflowAppRun(input.runtime.app, input.runtime.getRun(runId));
  const snapshotRun = (run: { runId: string }) => snapshot(run.runId);

  return {
    async answerQuestion(request, params = {}) {
      const runId = requireParam(params, "runId");
      const questionId = requireParam(params, "questionId");
      const body = objectBody(await readJson(request));
      return json({
        run: snapshotRun(await input.runtime.answerQuestion(runId, {
          questionId,
          value: body.value,
        })),
      });
    },

    getRun(_request, params = {}) {
      return json({ run: snapshot(requireParam(params, "runId")) });
    },

    listEvents(request, params = {}) {
      const run = input.runtime.getRun(requireParam(params, "runId"));
      const fromIndex = numberQuery(request, "fromIndex");
      return json({
        events: filterEvents(run.events, fromIndex),
      });
    },

    listRuns() {
      return json({
        runs: input.runtime.listRuns().map((run) => snapshotRun(run)),
      });
    },

    listWorkflows() {
      return json({
        workflows: input.runtime.listWorkflows(),
      });
    },

    async resumeHook(request, params = {}) {
      const token = requireParam(params, "token");
      const body = objectBody(await readJson(request));
      return json({
        run: snapshotRun(await input.runtime.resumeHook({
          token,
          value: body.value,
        })),
      });
    },

    async resumeRun(_request, params = {}) {
      return json({
        run: snapshotRun(await input.runtime.resumeRun(requireParam(params, "runId"))),
      });
    },

    async startRun(request, params = {}) {
      const body = objectBody(await readJson(request));
      const prompt = typeof body.input === "string" ? body.input : "";
      if (!prompt.trim()) {
        return jsonError("BAD_REQUEST", "Workflow app runs require a string input prompt.", 400);
      }
      return json({
        run: snapshotRun(await input.runtime.startRun({
          answers: recordBody(body.answers),
          attachments: attachmentBody(body.attachments),
          input: prompt,
          runId: typeof body.runId === "string" ? body.runId : undefined,
          triggerId: typeof body.triggerId === "string" ? body.triggerId : undefined,
          workflowId: params.workflowId ?? (typeof body.workflowId === "string" ? body.workflowId : undefined),
        })),
      }, 201);
    },

    streamEvents(request, params = {}) {
      const runId = requireParam(params, "runId");
      return liveEventStreamResponse(liveWorkflowAppEvents(
        input.runtime,
        runId,
        numberQuery(request, "fromIndex"),
      ));
    },
  };
}

export function createWorkflowAppHttpAdapter(input: CreateWorkflowAppHttpAdapterInput): WorkflowAppHttpAdapter {
  const basePath = normalizeBasePath(input.basePath ?? "/api/workflow-app");
  const routes = createWorkflowAppHttpRoutes(input);
  return {
    routes,
    async fetch(request) {
      try {
        const match = matchWorkflowAppRoute(request, basePath);
        if (!match) return jsonError("NOT_FOUND", "Not found.", 404);
        return routes[match.handler](request, match.params);
      } catch (error) {
        return jsonError("BAD_REQUEST", error instanceof Error ? error.message : String(error), 400);
      }
    },
  };
}

export function createWorkflowAppClient(input: CreateWorkflowAppClientInput): WorkflowAppClient {
  if ("runtime" in input) {
    const runtime = input.runtime;
    const snapshot = (runId: string) => snapshotWorkflowAppRun(runtime.app, runtime.getRun(runId));
    return {
      hooks: {
        async resume(resumeInput) {
          const run = await runtime.resumeHook(resumeInput);
          return snapshot(run.runId);
        },
      },
      runs: {
        async answerQuestion(runId, answerInput) {
          const run = await runtime.answerQuestion(runId, answerInput);
          return snapshot(run.runId);
        },
        async create(startInput) {
          const run = await runtime.startRun(startInput);
          return snapshot(run.runId);
        },
        async events(runId, body = {}) {
          return filterEvents(runtime.getRun(runId).events, body.fromIndex);
        },
        async get(runId) {
          return snapshot(runId);
        },
        async list() {
          return runtime.listRuns().map((run) => snapshot(run.runId));
        },
        async resume(runId) {
          const run = await runtime.resumeRun(runId);
          return snapshot(run.runId);
        },
        streamEvents(runId, body = {}) {
          return liveWorkflowAppEvents(runtime, runId, body.fromIndex);
        },
      },
      workflows: {
        async list() {
          return runtime.listWorkflows();
        },
      },
    };
  }

  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const fetcher = input.fetch ?? fetch;
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetcher(new Request(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
    }));
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const error = body.error as { message?: string } | undefined;
      throw new Error(error?.message ?? `Workflow app request failed with ${response.status}.`);
    }
    return body;
  };

  return {
    hooks: {
      async resume(resumeInput) {
        const body = await request(`/hooks/${encodeURIComponent(resumeInput.token)}/resume`, {
          body: JSON.stringify({ value: resumeInput.value }),
          method: "POST",
        });
        return (body as WorkflowAppRunResponse).run;
      },
    },
    runs: {
      async answerQuestion(runId, answerInput) {
        const body = await request(
          `/runs/${encodeURIComponent(runId)}/questions/${encodeURIComponent(answerInput.questionId)}/answer`,
          {
            body: JSON.stringify({ value: answerInput.value }),
            method: "POST",
          },
        );
        return (body as WorkflowAppRunResponse).run;
      },
      async create(startInput) {
        const body = await request("/runs", {
          body: JSON.stringify(startInput),
          method: "POST",
        });
        return (body as WorkflowAppRunResponse).run;
      },
      async events(runId, input = {}) {
        const body = await request(withQuery(`/runs/${encodeURIComponent(runId)}/events`, input));
        return body.events as EventRecord[];
      },
      async get(runId) {
        const body = await request(`/runs/${encodeURIComponent(runId)}`);
        return (body as WorkflowAppRunResponse).run;
      },
      async list() {
        const body = await request("/runs");
        return body.runs as WorkflowAppRunSnapshot[];
      },
      async resume(runId) {
        const body = await request(`/runs/${encodeURIComponent(runId)}/resume`, {
          method: "POST",
        });
        return (body as WorkflowAppRunResponse).run;
      },
      async *streamEvents(runId, input = {}) {
        const response = await fetcher(new Request(
          `${baseUrl}${withQuery(`/runs/${encodeURIComponent(runId)}/events/stream`, input)}`,
        ));
        if (!response.ok) {
          throw new Error(await workflowAppHttpErrorMessage(response));
        }
        yield* parseEventStream(response);
      },
    },
    workflows: {
      async list() {
        const body = await request("/workflows");
        return body.workflows as WorkflowAppWorkflowDescriptor[];
      },
    },
  };
}

function matchWorkflowAppRoute(request: Request, basePath: string): WorkflowAppHttpMatch | null {
  const url = new URL(request.url);
  const path = stripBasePath(url.pathname, basePath);
  if (request.method === "GET" && path === "/workflows") return { handler: "listWorkflows" };
  if (request.method === "GET" && path === "/runs") return { handler: "listRuns" };
  if (request.method === "POST" && path === "/runs") return { handler: "startRun" };

  const workflowRun = path.match(/^\/workflows\/([^/]+)\/runs$/);
  if (request.method === "POST" && workflowRun?.[1]) {
    return {
      handler: "startRun",
      params: { workflowId: decodeURIComponent(workflowRun[1]) },
    };
  }

  const questionAnswer = path.match(/^\/runs\/([^/]+)\/questions\/([^/]+)\/answer$/);
  if (request.method === "POST" && questionAnswer?.[1] && questionAnswer[2]) {
    return {
      handler: "answerQuestion",
      params: {
        questionId: decodeURIComponent(questionAnswer[2]),
        runId: decodeURIComponent(questionAnswer[1]),
      },
    };
  }

  const runPath = path.match(/^\/runs\/([^/]+)(?:\/(events(?:\/stream)?|resume))?$/);
  if (runPath?.[1]) {
    const params = { runId: decodeURIComponent(runPath[1]) };
    const suffix = runPath[2];
    if (request.method === "GET" && !suffix) return { handler: "getRun", params };
    if (request.method === "GET" && suffix === "events") return { handler: "listEvents", params };
    if (request.method === "GET" && suffix === "events/stream") return { handler: "streamEvents", params };
    if (request.method === "POST" && suffix === "resume") return { handler: "resumeRun", params };
  }

  const hookResume = path.match(/^\/hooks\/([^/]+)\/resume$/);
  if (request.method === "POST" && hookResume?.[1]) {
    return {
      handler: "resumeHook",
      params: { token: decodeURIComponent(hookResume[1]) },
    };
  }

  return null;
}

function requireParam<TName extends keyof WorkflowAppHttpRouteParams>(
  params: WorkflowAppHttpRouteParams,
  name: TName,
): string {
  const value = params[name];
  if (!value) throw new Error(`Missing route parameter: ${name}`);
  return value;
}

function normalizeBasePath(value: string) {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function stripBasePath(pathname: string, basePath: string) {
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length);
  }
  return pathname;
}

function numberQuery(request: Request, key: string) {
  const value = new URL(request.url).searchParams.get(key);
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function attachmentBody(value: unknown): WorkflowAppInputAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value.flatMap((item): WorkflowAppInputAttachment[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.label !== "string" || typeof record.mediaType !== "string" || typeof record.name !== "string") {
      return [];
    }
    return [{
      label: record.label,
      mediaType: record.mediaType,
      name: record.name,
      path: typeof record.path === "string" ? record.path : undefined,
      size: typeof record.size === "number" ? record.size : undefined,
    }];
  });
  return attachments.length ? attachments : undefined;
}

function withQuery(path: string, input: { fromIndex?: number }) {
  if (input.fromIndex === undefined) return path;
  return `${path}?fromIndex=${encodeURIComponent(String(input.fromIndex))}`;
}

function recordBody(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
