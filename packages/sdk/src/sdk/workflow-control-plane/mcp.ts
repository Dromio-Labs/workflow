import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type ListResourcesResult,
  type ListToolsResult,
  type ReadResourceResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  EnqueueTriggerInput,
  TriggerDescriptor,
  TriggerJobFilter,
  WorkflowControlPlane,
  WorkflowRunFilter,
} from "./types.js";
import {
  WORKFLOW_MCP_APP_MIME_TYPE,
  WORKFLOW_MCP_APP_URI,
  workflowMcpAppHtml,
} from "./mcp-app.js";

export type CreateWorkflowControlPlaneMcpProviderInput = {
  auth?: {
    bearerToken?: string;
    trusted?: boolean;
  };
  controlPlane: WorkflowControlPlane;
  extraTools?: WorkflowControlPlaneMcpTool[];
  includeTriggerTools?: boolean;
  name?: string;
  toolPrefix?: string;
  version?: string;
};

export type WorkflowControlPlaneMcpTool = {
  description: string;
  handler(args: Record<string, unknown>): Promise<Record<string, unknown>> | Record<string, unknown>;
  inputSchema?: Tool["inputSchema"];
  name: string;
  readOnly?: boolean;
  title?: string;
};

export type WorkflowControlPlaneMcpProvider = {
  callTool(name: string, args?: unknown): Promise<CallToolResult>;
  fetch(request: Request): Promise<Response>;
  listResources(): Promise<ListResourcesResult>;
  listTools(): Promise<ListToolsResult>;
  readResource(uri: string): Promise<ReadResourceResult>;
  server: Server;
  serveStdio(): Promise<void>;
};

const EMPTY_INPUT_SCHEMA = {
  additionalProperties: false,
  type: "object",
} as const;

export function createWorkflowControlPlaneMcpProvider(
  input: CreateWorkflowControlPlaneMcpProviderInput,
): WorkflowControlPlaneMcpProvider {
  const prefix = sanitizeToolName(input.toolPrefix ?? input.name ?? "dromio");
  const server = createMcpServer(input, prefix);

  const provider = {
    async callTool(name, args) {
      try {
        return await callWorkflowTool(input, prefix, name, objectInput(args));
      } catch (error) {
        return mcpErrorResult(error);
      }
    },
    async fetch(request) {
      if (request.method === "OPTIONS") return corsPreflightResponse();
      const requestInput = {
        ...input,
        auth: {
          ...input.auth,
          bearerToken: bearerToken(request) ?? input.auth?.bearerToken,
        },
      };
      const requestServer = createMcpServer(requestInput, prefix);
      const transport = new WebStandardStreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: undefined,
      });
      try {
        await requestServer.connect(transport);
        return withCors(await transport.handleRequest(request));
      } catch (error) {
        return withCors(jsonRpcErrorResponse(error instanceof Error ? error.message : String(error)));
      }
    },
    async listTools() {
      return { tools: await listWorkflowTools(input, prefix) };
    },
    async listResources() {
      return workflowMcpAppResources();
    },
    async readResource(uri) {
      return readWorkflowMcpAppResource(uri, prefix);
    },
    server,
    async serveStdio() {
      await server.connect(new StdioServerTransport());
    },
  } satisfies WorkflowControlPlaneMcpProvider;

  return provider;
}

export const createWorkflowControlPlaneMcpServer = createWorkflowControlPlaneMcpProvider;

function createMcpServer(input: CreateWorkflowControlPlaneMcpProviderInput, prefix: string): Server {
  const server = new Server(
    { name: input.name ?? prefix, version: input.version ?? "0.1.0" },
    { capabilities: { resources: {}, tools: {} } },
  );
  server.setRequestHandler(ListResourcesRequestSchema, async () => workflowMcpAppResources());
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => (
    readWorkflowMcpAppResource(request.params.uri, prefix)
  ));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await listWorkflowTools(input, prefix),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await callWorkflowTool(input, prefix, request.params.name, objectInput(request.params.arguments));
    } catch (error) {
      return mcpErrorResult(error);
    }
  });
  return server;
}

async function listWorkflowTools(
  input: CreateWorkflowControlPlaneMcpProviderInput,
  prefix: string,
): Promise<Tool[]> {
  const controlPlane = input.controlPlane;
  const tools: Tool[] = [
    tool(`${prefix}.list_workflows`, "List registered workflows.", EMPTY_INPUT_SCHEMA, true),
    tool(`${prefix}.list_triggers`, "List published workflow triggers.", EMPTY_INPUT_SCHEMA, true),
    tool(`${prefix}.fire_trigger`, "Enqueue a published trigger job.", {
      properties: {
        idempotencyKey: { type: "string" },
        input: {},
        triggerId: { type: "string" },
      },
      required: ["triggerId", "input"],
      type: "object",
    }),
    tool(`${prefix}.list_jobs`, "List trigger jobs.", {
      properties: {
        status: { type: "string" },
        triggerId: { type: "string" },
        workflowId: { type: "string" },
      },
      type: "object",
    }, true),
    tool(`${prefix}.get_job`, "Get one trigger job.", {
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
      type: "object",
    }, true),
    tool(`${prefix}.list_runs`, "List workflow runs.", {
      properties: {
        originType: { type: "string" },
        workflowId: { type: "string" },
      },
      type: "object",
    }, true),
    tool(`${prefix}.get_run`, "Get one workflow run.", {
      properties: { runId: { type: "string" } },
      required: ["runId"],
      type: "object",
    }, true, undefined, true),
    tool(`${prefix}.answer_question`, "Answer one pending workflow question and return the updated run.", {
      additionalProperties: false,
      properties: {
        questionId: { type: "string" },
        runId: { type: "string" },
        value: {},
      },
      required: ["runId", "questionId", "value"],
      type: "object",
    }),
    tool(`${prefix}.resume_hook`, "Resume a suspended workflow hook with JSON-compatible output.", {
      additionalProperties: false,
      properties: {
        source: {
          additionalProperties: false,
          properties: {
            adapter: { type: "string" },
            capabilities: { items: { type: "string" }, type: "array" },
            participant: { type: "string" },
          },
          type: "object",
        },
        token: { type: "string" },
        value: {},
      },
      required: ["token", "value"],
      type: "object",
    }),
  ];

  for (const extraTool of input.extraTools ?? []) {
    tools.push(tool(
      extraTool.name,
      extraTool.description,
      extraTool.inputSchema ?? EMPTY_INPUT_SCHEMA,
      extraTool.readOnly ?? true,
      extraTool.title,
    ));
  }

  if (input.includeTriggerTools === false) return tools;
  for (const trigger of await controlPlane.listTriggers()) {
    if (!trigger.enabled) continue;
    tools.push(triggerTool(prefix, trigger));
  }
  return tools;
}

async function callWorkflowTool(
  input: CreateWorkflowControlPlaneMcpProviderInput,
  prefix: string,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const controlPlane = input.controlPlane;
  const extraTool = input.extraTools?.find((item) => item.name === name);
  if (extraTool) return mcpResult(await extraTool.handler(args));
  if (name === `${prefix}.list_workflows`) return mcpResult({ workflows: await controlPlane.listWorkflows() });
  if (name === `${prefix}.list_triggers`) return mcpResult({ triggers: await controlPlane.listTriggers() });
  if (name === `${prefix}.list_jobs`) return mcpResult({ jobs: await controlPlane.listTriggerJobs(jobFilter(args)) });
  if (name === `${prefix}.get_job`) return mcpResult({ job: await controlPlane.getTriggerJob(requiredString(args, "jobId")) });
  if (name === `${prefix}.list_runs`) return mcpResult({ runs: await controlPlane.listRuns(runFilter(args)) });
  if (name === `${prefix}.get_run`) {
    const run = await controlPlane.getRun(requiredString(args, "runId"));
    return mcpResult({ run, workflow: await controlPlane.getWorkflow(run.workflowId) });
  }
  if (name === `${prefix}.answer_question`) {
    return mcpResult({
      run: await controlPlane.answerQuestion(requiredString(args, "runId"), {
        questionId: requiredString(args, "questionId"),
        value: requiredValue(args, "value"),
      }),
    });
  }
  if (name === `${prefix}.resume_hook`) {
    return mcpResult({
      run: await controlPlane.resumeHook({
        source: resumeSource(args.source),
        token: requiredString(args, "token"),
        value: requiredValue(args, "value"),
      }),
    });
  }
  if (name === `${prefix}.fire_trigger`) {
    return mcpResult(await enqueueTrigger(input, requiredString(args, "triggerId"), args.input, args.idempotencyKey));
  }

  const trigger = (await controlPlane.listTriggers()).find((item) => triggerToolName(prefix, item) === name);
  if (trigger) return mcpResult(await enqueueTrigger(input, trigger.id, args, args.idempotencyKey));
  throw new Error(`Unknown MCP tool: ${name}`);
}

async function enqueueTrigger(
  input: CreateWorkflowControlPlaneMcpProviderInput,
  triggerId: string,
  triggerInput: unknown,
  idempotencyKey: unknown,
) {
  const enqueueInput: EnqueueTriggerInput = {
    bearerToken: input.auth?.bearerToken,
    idempotencyKey: typeof idempotencyKey === "string" && idempotencyKey ? idempotencyKey : undefined,
    input: triggerInput,
    source: "mcp",
    trusted: input.auth?.trusted ?? true,
    triggerId,
  };
  return input.controlPlane.enqueueTrigger(enqueueInput);
}

function triggerTool(prefix: string, trigger: TriggerDescriptor): Tool {
  return tool(
    triggerToolName(prefix, trigger),
    trigger.description ?? `Enqueue ${trigger.label}.`,
    objectJsonSchema(trigger.input?.jsonSchema),
    false,
    trigger.label,
  );
}

function tool(
  name: string,
  description: string,
  inputSchema: Tool["inputSchema"],
  readOnly = false,
  title?: string,
  app = false,
): Tool {
  return {
    annotations: {
      destructiveHint: !readOnly,
      readOnlyHint: readOnly,
      title,
    },
    description,
    inputSchema,
    ...(app ? { _meta: { ui: { resourceUri: WORKFLOW_MCP_APP_URI } } } : {}),
    name,
    title,
  };
}

function workflowMcpAppResources(): ListResourcesResult {
  return {
    resources: [{
      description: "Interactive durable workflow run inspector and suspension controls.",
      mimeType: WORKFLOW_MCP_APP_MIME_TYPE,
      name: "Dromio workflow run",
      uri: WORKFLOW_MCP_APP_URI,
    }],
  };
}

function readWorkflowMcpAppResource(uri: string, prefix: string): ReadResourceResult {
  if (uri !== WORKFLOW_MCP_APP_URI) throw new Error(`Unknown MCP resource: ${uri}`);
  return {
    contents: [{
      mimeType: WORKFLOW_MCP_APP_MIME_TYPE,
      text: workflowMcpAppHtml(prefix),
      uri: WORKFLOW_MCP_APP_URI,
    }],
  };
}

function triggerToolName(prefix: string, trigger: TriggerDescriptor): string {
  return `${prefix}.trigger.${sanitizeToolName(trigger.id)}`;
}

function mcpResult(data: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ text: JSON.stringify(data, null, 2), type: "text" }],
    isError,
    structuredContent: data,
  };
}

function mcpErrorResult(error: unknown): CallToolResult {
  const candidate = error as { code?: unknown; message?: unknown } | undefined;
  return mcpResult({
    ...(typeof candidate?.code === "string" ? { code: candidate.code } : {}),
    error: error instanceof Error ? error.message : String(error),
  }, true);
}

function objectInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`MCP tool requires string '${key}'.`);
  return value;
}

function requiredValue(args: Record<string, unknown>, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(args, key) || args[key] === undefined) {
    throw new Error(`MCP tool requires JSON-compatible '${key}'.`);
  }
  return args[key];
}

function resumeSource(value: unknown): { adapter?: string; capabilities?: string[]; participant?: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const adapter = typeof source.adapter === "string" && source.adapter.trim()
    ? source.adapter.trim()
    : undefined;
  const participant = typeof source.participant === "string" && source.participant.trim()
    ? source.participant.trim()
    : undefined;
  const capabilities = Array.isArray(source.capabilities)
    ? source.capabilities.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .map((item) => item.trim())
    : undefined;
  return adapter || participant || capabilities?.length
    ? { adapter, capabilities, participant }
    : undefined;
}

function jobFilter(args: Record<string, unknown>): TriggerJobFilter {
  return {
    status: typeof args.status === "string" ? args.status as TriggerJobFilter["status"] : undefined,
    triggerId: typeof args.triggerId === "string" ? args.triggerId : undefined,
    workflowId: typeof args.workflowId === "string" ? args.workflowId : undefined,
  };
}

function runFilter(args: Record<string, unknown>): WorkflowRunFilter {
  return {
    originType: typeof args.originType === "string" ? args.originType as WorkflowRunFilter["originType"] : undefined,
    workflowId: typeof args.workflowId === "string" ? args.workflowId : undefined,
  };
}

function objectJsonSchema(schema: unknown): Tool["inputSchema"] {
  if (schema && typeof schema === "object" && !Array.isArray(schema) && (schema as { type?: unknown }).type === "object") {
    return schema as Tool["inputSchema"];
  }
  return {
    properties: {
      input: schema && typeof schema === "object" ? schema : {},
    },
    required: ["input"],
    type: "object",
  };
}

function sanitizeToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 128);
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function corsPreflightResponse(): Response {
  return withCors(new Response(null, { status: 204 }));
}

function jsonRpcErrorResponse(message: string): Response {
  return new Response(JSON.stringify({
    error: {
      code: -32603,
      message,
    },
    id: null,
    jsonrpc: "2.0",
  }), {
    status: 500,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-headers", [
    "authorization",
    "content-type",
    "last-event-id",
    "mcp-protocol-version",
    "mcp-session-id",
  ].join(", "));
  headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-expose-headers", "mcp-protocol-version, mcp-session-id");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
