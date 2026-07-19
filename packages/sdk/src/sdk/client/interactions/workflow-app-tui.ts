import type {
  WorkflowApp,
  WorkflowAppRuntime,
} from "./workflow-app.js";
import type {
  TriggerDescriptor,
  WorkflowControlPlane,
} from "../../workflow-control-plane/index.js";

export type WorkflowTuiTriggerBoundaryInfo = {
  id: string;
  input?: readonly {
    jsonSchema?: unknown;
    key: string;
  }[];
  type?: string;
};

export type WorkflowTuiTriggerBoundaryMatch = "exact" | "none" | "workflow";

export type WorkflowTuiTriggerBoundarySummary = {
  boundaryId: string;
  boundaryType: string;
  inputKeys: string[];
  inputSchemaLines: string[];
  inputSchemas: string[];
  match: WorkflowTuiTriggerBoundaryMatch;
  publishedInputSchema?: string;
  publishedInputSchemaLines?: string[];
  publishedTrigger?: TriggerDescriptor;
  publishedTriggers: TriggerDescriptor[];
};

export type RunWorkflowTuiAppOptions = {
  artifactDirectory?: false | string;
  commandName?: string;
  defaultPrompt?: string;
  emptyAnswerHint?: false | string;
  exportWorkflows?: WorkflowTuiExportHandler;
  initialRunId?: string;
  initialWorkflowId?: string;
  onInterrupt?: () => Promise<void> | void;
  output?: {
    write(chunk: string): unknown;
  };
  controlPlane?: WorkflowControlPlane;
  keymap?: Partial<WorkflowTuiKeymap>;
  runtime?: WorkflowAppRuntime;
  showExitSummary?: boolean;
};

export type WorkflowTuiExportFieldDescriptor = {
  description?: string;
  id: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  step?: "app" | "registry" | "release";
  type?: "boolean" | "path" | "string" | "url";
};

export type WorkflowTuiExportRequest = {
  fields: Record<string, string>;
  workflowIds: string[];
};

export type WorkflowTuiExportResult = {
  binaryPath?: string;
  bundleDir?: string;
  manifestPath?: string;
  message?: string;
  release?: string;
};

export type WorkflowTuiExportHandler = {
  fields?: WorkflowTuiExportFieldDescriptor[];
  run(input: WorkflowTuiExportRequest): Promise<WorkflowTuiExportResult> | WorkflowTuiExportResult;
};

export type WorkflowTuiKeymap = {
  cancelJob: string;
  commandPalette: string;
  contextPanelToggle: string;
  copyCurl: string;
  copyId: string;
  deadLetterJob: string;
  fireTrigger: string;
  jobs: string;
  leader: string;
  openEditor: string;
  openApi: string;
  openSwagger: string;
  refresh: string;
  retryJob: string;
  triggers: string;
  viewRun: string;
};

export const DEFAULT_WORKFLOW_TUI_KEYMAP: WorkflowTuiKeymap = {
  cancelJob: "<leader>x",
  commandPalette: "ctrl+p",
  contextPanelToggle: "<leader>b",
  copyCurl: "<leader>c",
  copyId: "<leader>y",
  deadLetterJob: "<leader>d",
  fireTrigger: "f",
  jobs: "j",
  leader: "ctrl+x",
  openEditor: "<leader>e",
  openApi: "<leader>o",
  openSwagger: "<leader>s",
  refresh: "r",
  retryJob: "<leader>r",
  triggers: "t",
  viewRun: "return",
};

export function normalizeWorkflowTuiKeymap(
  keymap: Partial<WorkflowTuiKeymap> = {},
): WorkflowTuiKeymap {
  return {
    ...DEFAULT_WORKFLOW_TUI_KEYMAP,
    ...keymap,
  };
}

export function workflowTuiDefaultHttpBaseUrl() {
  const configured = process.env.INTENT_CONTROL_PLANE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `http://localhost:${process.env.PORT ?? "4323"}`;
}

export function workflowTuiApiUrl(pathname: string, baseUrl = workflowTuiDefaultHttpBaseUrl()) {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export function workflowTuiOpenApiUrl(baseUrl?: string) {
  return workflowTuiApiUrl("/api/openapi.json", baseUrl);
}

export function workflowTuiSwaggerUrl(baseUrl?: string) {
  return workflowTuiApiUrl("/api/swagger", baseUrl);
}

export function workflowTuiTriggerCurl(input: {
  bearerTokenPlaceholder?: string;
  baseUrl?: string;
  idempotencyKeyPlaceholder?: string;
  inputJson?: string;
  trigger: TriggerDescriptor;
}) {
  const method = input.trigger.config?.method ?? "POST";
  const pathname = input.trigger.config?.path ?? `/api/triggers/${encodeURIComponent(input.trigger.id)}`;
  const body = input.inputJson?.trim() || "{}";
  return [
    `curl -X ${method} ${shellQuote(workflowTuiApiUrl(pathname, input.baseUrl))}`,
    "  -H 'content-type: application/json'",
    `  -H 'authorization: Bearer ${input.bearerTokenPlaceholder ?? "$INTENT_API_TOKEN"}'`,
    `  -H 'idempotency-key: ${input.idempotencyKeyPlaceholder ?? "$(uuidgen)"}'`,
    `  --data ${shellQuote(body)}`,
  ].join(" \\\n");
}

export function workflowTuiTriggerBoundarySummary(input: {
  trigger?: WorkflowTuiTriggerBoundaryInfo;
  triggers?: readonly TriggerDescriptor[];
  workflowId: string;
}): WorkflowTuiTriggerBoundarySummary {
  const boundaryId = input.trigger?.id ?? "$trigger";
  const workflowTriggers = (input.triggers ?? []).filter((trigger) => trigger.workflowId === input.workflowId);
  const exactTriggers = workflowTriggers.filter((trigger) => triggerMatchesBoundary(trigger, input.workflowId, boundaryId));
  const publishedTriggers = exactTriggers.length > 0 ? exactTriggers : workflowTriggers;
  return {
    boundaryId,
    boundaryType: input.trigger?.type ?? "trigger",
    inputKeys: (input.trigger?.input ?? []).map((port) => port.key),
    inputSchemaLines: triggerInputSchemaLines(input.trigger?.input ?? []),
    inputSchemas: (input.trigger?.input ?? []).map((port) =>
      `${port.key}: ${workflowTuiJsonSchemaSummary(port.jsonSchema)}`
    ),
    match: exactTriggers.length > 0 ? "exact" : workflowTriggers.length > 0 ? "workflow" : "none",
    publishedInputSchema: publishedTriggers[0]?.input?.jsonSchema
      ? workflowTuiJsonSchemaSummary(publishedTriggers[0].input?.jsonSchema)
      : undefined,
    publishedInputSchemaLines: publishedTriggers[0]?.input?.jsonSchema
      ? workflowTuiJsonSchemaLines(publishedTriggers[0].input?.jsonSchema)
      : undefined,
    publishedTrigger: publishedTriggers[0],
    publishedTriggers,
  };
}

function triggerInputSchemaLines(ports: readonly { jsonSchema?: unknown; key: string }[]): string[] {
  if (ports.length === 0) return ["none"];
  return ports.flatMap((port) => {
    const lines = workflowTuiJsonSchemaLines(port.jsonSchema);
    if (lines.length === 1) return [`${port.key}: ${lines[0]}`];
    return [`${port.key}:`, ...lines.map((line) => `  ${line}`)];
  });
}

function workflowTuiJsonSchemaSummary(schema: unknown): string {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return "unknown";
  const record = schema as Record<string, unknown>;
  if (Array.isArray(record.anyOf)) {
    return `anyOf(${record.anyOf.slice(0, 3).map(schemaTypeSummary).join(" | ")}${record.anyOf.length > 3 ? " | ..." : ""})`;
  }
  if (Array.isArray(record.oneOf)) {
    return `oneOf(${record.oneOf.slice(0, 3).map(schemaTypeSummary).join(" | ")}${record.oneOf.length > 3 ? " | ..." : ""})`;
  }
  const type = typeof record.type === "string" ? record.type : schemaTypeSummary(schema);
  if (type === "object") {
    const properties = record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
      ? record.properties as Record<string, unknown>
      : {};
    const required = new Set(Array.isArray(record.required) ? record.required.filter((item): item is string => typeof item === "string") : []);
    const entries = Object.entries(properties).slice(0, 4).map(([key, value]) =>
      `${key}${required.has(key) ? "*" : ""}: ${schemaTypeSummary(value)}`
    );
    if (entries.length === 0) return "object";
    return `object { ${entries.join(", ")}${Object.keys(properties).length > entries.length ? ", ..." : ""} }`;
  }
  if (type === "array") {
    return `array<${schemaTypeSummary(record.items)}>`;
  }
  if (type === "string" && typeof record.minLength === "number") {
    return `string minLength ${record.minLength}`;
  }
  if ((type === "number" || type === "integer") && typeof record.minimum === "number") {
    return `${type} min ${record.minimum}`;
  }
  return type;
}

function workflowTuiJsonSchemaLines(schema: unknown, depth = 0): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return ["unknown"];
  const record = schema as Record<string, unknown>;
  if (Array.isArray(record.anyOf)) return schemaUnionLines("one of", record.anyOf, depth);
  if (Array.isArray(record.oneOf)) return schemaUnionLines("one of", record.oneOf, depth);
  const type = typeof record.type === "string" ? record.type : schemaTypeSummary(schema);
  if (type === "object") return schemaObjectLines(record, depth);
  if (type === "array") return [`array of ${schemaTypeSummary(record.items)}`];
  if (type === "string" && typeof record.minLength === "number") return [`string, min length ${record.minLength}`];
  if ((type === "number" || type === "integer") && typeof record.minimum === "number") return [`${type}, min ${record.minimum}`];
  return [type];
}

function schemaUnionLines(label: string, options: unknown[], depth: number): string[] {
  const lines = [`accepts ${label}:`];
  for (const option of options.slice(0, 3)) {
    const optionLines = workflowTuiJsonSchemaLines(option, depth + 1);
    const [first, ...rest] = optionLines;
    lines.push(`- ${first ?? "unknown"}`);
    lines.push(...rest.map((line) => `  ${line}`));
  }
  if (options.length > 3) lines.push(`- ${options.length - 3} more options`);
  return lines;
}

function schemaObjectLines(record: Record<string, unknown>, depth: number): string[] {
  const properties = record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
    ? record.properties as Record<string, unknown>
    : {};
  const required = new Set(Array.isArray(record.required) ? record.required.filter((item): item is string => typeof item === "string") : []);
  const entries = Object.entries(properties);
  if (entries.length === 0) return ["object"];
  const limit = depth > 0 ? 6 : 8;
  return [
    "object with fields:",
    ...entries.slice(0, limit).map(([key, value]) =>
      `${required.has(key) ? "*" : " "}${key}: ${schemaTypeSummary(value)}`
    ),
    ...(entries.length > limit ? [` ${entries.length - limit} more fields`] : []),
  ];
}

function schemaTypeSummary(schema: unknown): string {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return "unknown";
  const record = schema as Record<string, unknown>;
  if (typeof record.type === "string") return record.type;
  if (Array.isArray(record.anyOf)) return "anyOf";
  if (Array.isArray(record.oneOf)) return "oneOf";
  if (record.properties && typeof record.properties === "object") return "object";
  if (record.items) return "array";
  return "schema";
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function triggerMatchesBoundary(
  trigger: TriggerDescriptor,
  workflowId: string,
  boundaryId: string,
) {
  const sourceTriggerId = typeof trigger.source?.triggerId === "string" ? trigger.source.triggerId : undefined;
  return sourceTriggerId === boundaryId ||
    trigger.id === `${workflowId}.${boundaryId}` ||
    trigger.id.endsWith(`.${boundaryId}`);
}

export async function runWorkflowTuiApp(
  app: WorkflowApp,
  options: RunWorkflowTuiAppOptions = {},
) {
  await import("@opentui/solid/preload");
  const implementation = await import("./workflow-app-tui.impl.js");
  return implementation.runWorkflowTuiApp(app, options);
}
