import type {
  WorkflowControlPlane,
} from "../types.js";

export async function createOpenApiDocument(controlPlane: WorkflowControlPlane, request: Request) {
  const url = new URL(request.url);
  const triggers = await controlPlane.listTriggers();
  const signals = await controlPlane.listSignals();
  const paths: Record<string, unknown> = {
    "/api/workflows": {
      get: operation("List workflows", "workflows.read", "WorkflowListResponse"),
    },
    "/api/runs": {
      get: operation("List workflow runs", "runs.read", "WorkflowRunListResponse"),
      post: operation("Start workflow run", "runs.write", "WorkflowRunResponse", {
        requestBody: schemaRequestBody({
          properties: {
            input: { type: "string" },
            runId: { type: "string" },
            workflowId: { type: "string" },
          },
          required: ["input", "workflowId"],
          type: "object",
        }),
      }),
    },
    "/api/signals": {
      get: operation("List signals", "signals.read", "SignalListResponse"),
    },
    "/api/signal-occurrences/{occurrenceId}": {
      get: operation(
        "Get signal occurrence receipt",
        "signal-occurrences.read",
        "SignalOccurrenceResponse",
        { parameters: [pathParameter("occurrenceId")] },
      ),
    },
    "/api/runs/{runId}": {
      get: operation("Get workflow run", "runs.read", "WorkflowRunResponse", {
        parameters: [pathParameter("runId")],
      }),
    },
    "/api/runs/{runId}/events": {
      get: operation("Stream workflow run events", "runs.read", "WorkflowRunEventStreamResponse", {
        parameters: [pathParameter("runId")],
      }),
    },
    "/api/runs/{runId}/questions/{questionId}/answer": {
      post: operation("Answer workflow run question", "runs.write", "WorkflowRunResponse", {
        parameters: [pathParameter("runId"), pathParameter("questionId")],
        requestBody: schemaRequestBody({ type: "object", properties: { value: {} } }),
      }),
    },
    "/api/runs/{runId}/resume": {
      post: operation("Resume workflow run", "runs.write", "WorkflowRunResponse", {
        parameters: [pathParameter("runId")],
      }),
    },
    "/api/hooks/{token}/resume": {
      post: operation("Resume workflow hook", "runs.write", "WorkflowRunResponse", {
        parameters: [pathParameter("token")],
        requestBody: schemaRequestBody({ type: "object", properties: { value: {} } }),
      }),
    },
    "/api/triggers": {
      get: operation("List triggers", "triggers.read", "TriggerListResponse"),
    },
    "/api/trigger-jobs": {
      get: operation("List trigger jobs", "jobs.read", "TriggerJobListResponse"),
    },
    "/api/trigger-jobs/{jobId}": {
      get: operation("Get trigger job", "jobs.read", "TriggerJobResponse", {
        parameters: [pathParameter("jobId")],
      }),
    },
    "/api/trigger-jobs/{jobId}/events": {
      get: operation("Stream trigger job events", "jobs.read", "TriggerJobEventStreamResponse", {
        parameters: [pathParameter("jobId")],
      }),
    },
    "/api/trigger-jobs/{jobId}/retry": {
      post: operation("Retry trigger job", "jobs.write", "TriggerJobResponse", {
        parameters: [pathParameter("jobId")],
        requestBody: schemaRequestBody({ type: "object", properties: { retryDelayMs: { type: "number" } } }),
      }),
    },
    "/api/trigger-jobs/{jobId}/dead-letter": {
      post: operation("Dead-letter trigger job", "jobs.write", "TriggerJobResponse", {
        parameters: [pathParameter("jobId")],
        requestBody: schemaRequestBody({ type: "object", properties: { error: { type: "string" } } }),
      }),
    },
    "/api/trigger-jobs/{jobId}/cancel": {
      post: operation("Cancel trigger job", "jobs.write", "TriggerJobResponse", {
        parameters: [pathParameter("jobId")],
        requestBody: schemaRequestBody({ type: "object", properties: { reason: { type: "string" } } }),
      }),
    },
  };
  for (const trigger of triggers) {
    const path = trigger.config?.path ?? `/api/triggers/${trigger.id}`;
    paths[path] = {
      get: {
        parameters: [pathParameter("triggerId")],
        responses: successResponses("TriggerResponse"),
        security: [{ bearerAuth: [] }],
        summary: `Get ${trigger.label}`,
      },
      post: {
        requestBody: schemaRequestBody(trigger.input?.jsonSchema ?? {}),
        responses: successResponses("TriggerInvokeResponse", ["200", "202"]),
        security: [{ bearerAuth: [] }],
        summary: `Invoke ${trigger.label}`,
      },
    };
    paths[`${path}/input-form`] = {
      get: {
        responses: successResponses("TriggerInputFormResponse"),
        security: [{ bearerAuth: [] }],
        summary: `Get ${trigger.label} input form`,
      },
    };
  }
  for (const signal of signals) {
    const path = `/api/signals/${signal.id}`;
    paths[path] = {
      get: operation(`Get ${signal.title ?? signal.id}`, "signals.read", "SignalResponse"),
    };
    paths[`${path}/occurrences`] = {
      post: operation(
        `Publish ${signal.title ?? signal.id}`,
        `signal.publish:${signal.id}`,
        "SignalOccurrenceResponse",
        {
          parameters: [idempotencyKeyParameter()],
          requestBody: schemaRequestBody({
            properties: {
              correlation: signal.correlationJsonSchema ?? {},
              occurredAt: { format: "date-time", type: "string" },
              payload: signal.payloadJsonSchema ?? {},
            },
            required: ["correlation", "payload"],
            type: "object",
          }),
        },
      ),
    };
  }
  return {
    components: {
      schemas: openApiSchemas(),
      securitySchemes: {
        bearerAuth: {
          scheme: "bearer",
          type: "http",
        },
      },
    },
    info: {
      title: "Dromio Workflow Control Plane",
      version: "1.0.0",
    },
    openapi: "3.1.0",
    paths,
    servers: [{ url: `${url.protocol}//${url.host}` }],
  };
}

function operation(
  summary: string,
  capability: string,
  responseSchema: string,
  options: {
    parameters?: unknown[];
    requestBody?: unknown;
  } = {},
) {
  return {
    ...options,
    responses: successResponses(responseSchema),
    security: [{ bearerAuth: [] }],
    summary,
    "x-intent-capability": capability,
  };
}

function successResponses(schemaRef: string, statuses = ["200"]) {
  return Object.fromEntries([
    ...statuses.map((status) => [
      status,
      {
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${schemaRef}` },
          },
        },
        description: "Success",
      },
    ]),
    ...["400", "401", "403", "404", "409", "410", "422", "500", "503"].map((status) => [
      status,
      {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
        description: "Error",
      },
    ]),
  ]);
}

function schemaRequestBody(schema: unknown) {
  return {
    content: {
      "application/json": { schema },
    },
    required: true,
  };
}

function pathParameter(name: string) {
  return {
    in: "path",
    name,
    required: true,
    schema: { type: "string" },
  };
}

function idempotencyKeyParameter() {
  return {
    in: "header",
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string" },
  };
}

function openApiSchemas() {
  return {
    ErrorResponse: {
      type: "object",
      required: ["error"],
      properties: {
        error: {
          type: "object",
          required: ["code", "message", "requestId"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            requestId: { type: "string" },
          },
        },
      },
    },
    SignalListResponse: {
      properties: { signals: { items: { type: "object" }, type: "array" } },
      type: "object",
    },
    SignalOccurrenceResponse: {
      properties: {
        created: { type: "boolean" },
        receipt: { $ref: "#/components/schemas/SignalOccurrenceReceipt" },
      },
      type: "object",
    },
    SignalOccurrenceReceipt: {
      properties: {
        attempts: { type: "number" },
        createdAt: { format: "date-time", type: "string" },
        error: { type: "string" },
        id: { type: "string" },
        occurredAt: { format: "date-time", type: "string" },
        signalId: { type: "string" },
        status: { enum: ["pending", "claimed", "delivered", "failed"], type: "string" },
        updatedAt: { format: "date-time", type: "string" },
      },
      required: ["id", "signalId", "status", "occurredAt", "createdAt", "updatedAt"],
      type: "object",
    },
    SignalResponse: { properties: { signal: { type: "object" } }, type: "object" },
    TriggerJob: {
      type: "object",
      required: ["id", "triggerId", "workflowId", "status", "attempts", "createdAt", "updatedAt"],
      properties: {
        attempts: { type: "number" },
        availableAt: { type: "string" },
        createdAt: { type: "string" },
        error: { type: "string" },
        id: { type: "string" },
        idempotencyKey: { type: "string" },
        maxAttempts: { type: "number" },
        occurrenceId: { type: "string" },
        runId: { type: "string" },
        status: {
          enum: ["queued", "claimed", "running", "retrying", "failed", "dead", "completed"],
          type: "string",
        },
        triggerId: { type: "string" },
        updatedAt: { type: "string" },
        workflowId: { type: "string" },
      },
    },
    TriggerJobResponse: {
      type: "object",
      properties: { job: { $ref: "#/components/schemas/TriggerJob" } },
    },
    TriggerJobListResponse: {
      type: "object",
      properties: {
        jobs: { type: "array", items: { $ref: "#/components/schemas/TriggerJob" } },
      },
    },
    TriggerInvokeResponse: {
      type: "object",
      properties: {
        job: { $ref: "#/components/schemas/TriggerJob" },
        jobId: { type: "string" },
        runId: { type: ["string", "null"] },
        status: { type: "string" },
        triggerId: { type: "string" },
        workflowId: { type: "string" },
      },
    },
    TriggerInputFormResponse: { type: "object" },
    TriggerListResponse: { type: "object", properties: { triggers: { type: "array", items: { type: "object" } } } },
    TriggerResponse: { type: "object", properties: { trigger: { type: "object" } } },
    WorkflowListResponse: { type: "object", properties: { workflows: { type: "array", items: { type: "object" } } } },
    WorkflowRunEventStreamResponse: { type: "string" },
    WorkflowRunListResponse: { type: "object", properties: { runs: { type: "array", items: { type: "object" } } } },
    WorkflowRunResponse: { type: "object", properties: { run: { type: "object" } } },
    TriggerJobEventStreamResponse: { type: "string" },
  };
}
