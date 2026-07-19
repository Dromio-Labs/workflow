import { existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  computeWorkflowRenderLayout,
  projectWorkflowGraphRenderModel,
  workflowRenderLayoutProfiles,
  type WorkflowRenderLayout,
  type WorkflowRenderModel,
} from "../workflow-render/index.js";
import type { WorkflowApp } from "./workflow-app/types.js";
import {
  createWorkflowAppRuntime,
  snapshotWorkflowAppRun,
} from "./workflow-app/runtime.js";
import type {
  EventRecord,
} from "../../core/index.js";
import type {
  WorkflowAppRun,
} from "./workflow-app/types.js";
import {
  renderWorkflowGuiPage,
  workflowGuiActivityScript,
  workflowGuiCanvasEdgesScript,
  workflowGuiClientScript,
  workflowGuiControlsScript,
  workflowGuiJsonScript,
  workflowGuiRuntimeScript,
  workflowGuiStyles,
} from "./workflow-app-gui/page.js";
import { serializeWorkflowBrowserShellBuild } from "./workflow-browser-shell-build.js";
import {
  encodeWorkflowTriggerSubmission,
  isJsonValue,
  normalizeWorkflowTriggerInput,
  type WorkflowTriggerDescriptor,
  type WorkflowTriggerInputDescriptor,
} from "@dromio/workflow-room-protocol";

export type WorkflowGuiWorkflow = {
  description?: string;
  id: string;
  layout: WorkflowRenderLayout;
  model: WorkflowRenderModel;
  title: string;
  trigger: WorkflowGuiTrigger;
  triggers: WorkflowGuiTrigger[];
};

export type WorkflowGuiTrigger = Omit<WorkflowTriggerDescriptor, "input"> & {
  input: WorkflowTriggerInputDescriptor;
};

export type WorkflowGuiStreamMessage =
  | { event: EventRecord; type: "event" }
  | { run: ReturnType<typeof snapshotWorkflowAppRun>; type: "run" }
  | { error: string; type: "error" };

export type WorkflowGuiPayload = {
  appId: string;
  defaultWorkflowId: string;
  title: string;
  workflows: WorkflowGuiWorkflow[];
};

export type WorkflowGuiWritable = {
  write(chunk: string): unknown;
};

export type CreateWorkflowGuiPayloadOptions = {
  defaultInput?: string;
};

export type RunWorkflowAppGuiOptions = {
  defaultInput?: string;
  hostname?: string;
  port?: number;
  onRun?: (run: WorkflowAppRun) => Promise<void> | void;
  onStop?: () => void;
  runtime?: ReturnType<typeof createWorkflowAppRuntime>;
  signalFetch?: (request: Request) => Promise<Response>;
  stdout?: WorkflowGuiWritable;
};

export type WorkflowAppGuiServer = {
  hostname: string;
  port: number;
  stop(): void;
  url: string;
};

let workflowGuiShellScript: Promise<string> | undefined;

export function createWorkflowGuiPayload(
  app: WorkflowApp,
  options: CreateWorkflowGuiPayloadOptions = {},
): WorkflowGuiPayload {
  const defaultInput = options.defaultInput?.trim();
  return {
    appId: app.id,
    defaultWorkflowId: app.defaultWorkflowId,
    title: app.title,
    workflows: app.listWorkflows().map((workflow) => {
      const triggers = workflow.triggers.map((trigger) => guiTrigger(trigger, defaultInput));
      const model = projectWorkflowGraphRenderModel({
        entryTriggers: triggers,
        graph: app.graph(workflow.id),
      });
      return {
        ...(workflow.description ? { description: workflow.description } : {}),
        id: workflow.id,
        layout: computeWorkflowRenderLayout(
          model,
          workflowRenderLayoutProfiles.web,
          initialNodeMeasurements(model),
        ),
        model,
        title: workflow.title,
        trigger: triggers[0]!,
        triggers,
      };
    }),
  };
}

function guiTrigger(trigger: WorkflowTriggerDescriptor, defaultInput?: string): WorkflowGuiTrigger {
  const input = normalizeWorkflowTriggerInput(trigger.input);
  return {
    ...trigger,
    input: defaultInput && input.kind === "prompt" ? { ...input, defaultValue: defaultInput } : input,
  };
}

function initialNodeMeasurements(model: WorkflowRenderModel): Record<string, { height: number; width: number }> {
  const measurements: Record<string, { height: number; width: number }> = {};
  for (const node of model.nodes) {
    if (node.kind === "initial") measurements[node.id] = { height: 24, width: 24 };
    if (node.childWorkflow) Object.assign(measurements, initialNodeMeasurements(node.childWorkflow.model));
  }
  return measurements;
}

export function runWorkflowAppGui(
  app: WorkflowApp,
  options: RunWorkflowAppGuiOptions = {},
): WorkflowAppGuiServer {
  const hostname = options.hostname ?? "127.0.0.1";
  const payload = createWorkflowGuiPayload(app, { defaultInput: options.defaultInput });
  const runtime = options.runtime ?? createWorkflowAppRuntime(app);
  const uploadRoot = join(tmpdir(), `dromio-workflow-gui-${randomUUID()}`);
  const runEventSinks = new Map<string, (event: EventRecord) => void>();
  const server = Bun.serve({
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      try {
        if (
          options.signalFetch
          && (pathname === "/api/signals"
            || pathname.startsWith("/api/signals/")
            || pathname.startsWith("/api/signal-occurrences/"))
        ) return options.signalFetch(request);
        if (pathname === "/") return html(renderWorkflowGuiPage(payload));
        if (pathname === "/activity.js") return asset(workflowGuiActivityScript, "text/javascript");
        if (pathname === "/canvas-edges.js") return asset(workflowGuiCanvasEdgesScript, "text/javascript");
        if (pathname === "/controls.js") return asset(workflowGuiControlsScript, "text/javascript");
        if (pathname === "/app.css") return asset(workflowGuiStyles, "text/css");
        if (pathname === "/app.js") return asset(workflowGuiClientScript, "text/javascript");
        if (pathname === "/json.js") return asset(workflowGuiJsonScript, "text/javascript");
        if (pathname === "/runtime.js") return asset(workflowGuiRuntimeScript, "text/javascript");
        if (pathname === "/shell.js") return asset(await browserShellScript(), "text/javascript");
        if (pathname === "/api/workflows") return json(payload);
        if (pathname === "/api/artifacts" && request.method === "POST") {
          return json(await saveWorkflowGuiArtifact(app, request, uploadRoot));
        }
        if (pathname === "/api/runs" && request.method === "POST") {
          const body = await runStartBody(app, request);
          return streamRun(app, async (send) => {
            let initialSink: ((event: EventRecord) => void) | undefined = (event) => {
              send({ event, type: "event" });
            };
            const completed = await runtime.startRun({
              attachments: body.attachments,
              input: body.input,
              onEvent(event) {
                (runEventSinks.get(event.runId) ?? initialSink)?.(event);
              },
              triggerId: body.triggerId,
              workflowId: body.workflowId,
            });
            initialSink = undefined;
            await options.onRun?.(completed);
            return completed;
          });
        }
        const answer = pathname.match(/^\/api\/runs\/([^/]+)\/questions\/([^/]+)$/);
        if (answer && request.method === "POST") {
          const runId = decodeURIComponent(answer[1]!);
          const questionId = decodeURIComponent(answer[2]!);
          const value = (await request.json() as { value?: unknown }).value;
          return streamRun(app, async (send) => {
            const sentIndexes = new Set<number>();
            const eventSink = (event: EventRecord) => {
              if (sentIndexes.has(event.index)) return;
              sentIndexes.add(event.index);
              send({ event, type: "event" });
            };
            runEventSinks.set(runId, eventSink);
            const unsubscribe = runtime.subscribe(runId, eventSink);
            try {
              await runtime.answerQuestion(runId, { questionId, value });
              const completed = await runtime.resumeRun(runId);
              await options.onRun?.(completed);
              return completed;
            } finally {
              runEventSinks.delete(runId);
              unsubscribe();
            }
          });
        }
        const run = pathname.match(/^\/api\/runs\/([^/]+)$/);
        if (run && request.method === "GET") {
          return json(snapshotWorkflowAppRun(app, runtime.getRun(decodeURIComponent(run[1]!))));
        }
        if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
        return new Response("Not found", { status: 404 });
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400);
      }
    },
    hostname,
    port: options.port ?? 3210,
  });
  const port = server.port ?? options.port ?? 3210;
  const displayHost = hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
  const url = `http://${displayHost}:${port}`;
  (options.stdout ?? process.stdout).write(`${app.title} GUI: ${url}\n`);
  return {
    hostname,
    port,
    stop() {
      void server.stop(true);
      rmSync(uploadRoot, { force: true, recursive: true });
      options.onStop?.();
    },
    url,
  };
}

function browserShellScript(): Promise<string> {
  workflowGuiShellScript ??= serializeWorkflowBrowserShellBuild(buildBrowserShellScript);
  return workflowGuiShellScript;
}

async function buildBrowserShellScript(): Promise<string> {
  const entrypoint = resolveBrowserShellEntrypoint(
    "workflow-app-gui/shell-client.tsx",
    "workflow-app-gui-shell-client.tsx",
  );
  const build = await Bun.build({
    entrypoints: [entrypoint],
    format: "esm",
    minify: true,
    packages: "bundle",
    plugins: [{
      name: "workflow-gui-react-deduplication",
      setup(builder) {
        builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => ({
          path: Bun.resolveSync(args.path, entrypoint),
        }));
      },
    }],
    target: "browser",
  });
  if (!build.success || !build.outputs[0]) {
    throw new Error(build.logs.map((log) => log.message).join("\n") || "Unable to build workflow GUI shell.");
  }
  return build.outputs[0].text();
}

function resolveBrowserShellEntrypoint(sourcePath: string, packagedFile: string): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  const source = join(directory, sourcePath);
  if (existsSync(source)) return source;
  for (let depth = 0; depth < 6; depth += 1) {
    const packaged = join(directory, packagedFile);
    if (existsSync(packaged)) return packaged;
    directory = dirname(directory);
  }
  throw new Error(`Unable to locate packaged browser shell: ${packagedFile}`);
}

function html(body: string) {
  return asset(body, "text/html");
}

function json(body: unknown) {
  return jsonResponse(body, 200);
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders("application/json"),
  });
}

function streamRun(
  app: WorkflowApp,
  run: (send: (message: WorkflowGuiStreamMessage) => void) => Promise<WorkflowAppRun>,
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (message: WorkflowGuiStreamMessage) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
      };
      void run(send).then((completed) => {
        send({ run: snapshotWorkflowAppRun(app, completed), type: "run" });
        controller.close();
      }).catch((error) => {
        send({ error: errorMessage(error), type: "error" });
        controller.close();
      });
    },
  });
  return new Response(stream, {
    headers: responseHeaders("application/x-ndjson"),
  });
}

async function runStartBody(app: WorkflowApp, request: Request) {
  const body = await request.json() as { attachments?: unknown; input?: unknown; triggerId?: unknown; workflowId?: unknown };
  if (typeof body.workflowId !== "string" || !body.workflowId.trim()) {
    throw new Error("workflowId is required.");
  }
  const workflow = app.listWorkflows().find((item) => item.id === body.workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${body.workflowId}`);
  const trigger = workflowTrigger(workflow, body.triggerId);
  const descriptor = normalizeWorkflowTriggerInput(trigger.input);
  const value = isJsonValue(body.input) ? body.input : undefined;
  const input = encodeWorkflowTriggerSubmission({
    ...(Array.isArray(body.attachments) ? { artifacts: guiAttachmentBody(body.attachments) } : {}),
    ...(value !== undefined ? { value } : {}),
  });
  if (descriptor.required && !input.trim()) {
    throw new Error(`Input is required for ${workflow.title}.`);
  }
  return {
    attachments: guiAttachmentBody(body.attachments),
    input,
    triggerId: trigger.id,
    workflowId: body.workflowId,
  };
}

function guiAttachmentBody(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const attachments = value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.label !== "string" || typeof record.mediaType !== "string" || typeof record.name !== "string") return [];
    return [{
      label: record.label,
      mediaType: record.mediaType,
      name: record.name,
      ...(typeof record.path === "string" ? { path: record.path } : {}),
      ...(typeof record.size === "number" ? { size: record.size } : {}),
    }];
  });
  return attachments.length ? attachments : undefined;
}

async function saveWorkflowGuiArtifact(app: WorkflowApp, request: Request, uploadRoot: string) {
  const form = await request.formData();
  const workflowId = form.get("workflowId");
  const triggerId = form.get("triggerId");
  const file = form.get("file");
  if (typeof workflowId !== "string") throw new Error("workflowId is required.");
  const workflow = app.listWorkflows().find((item) => item.id === workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  const trigger = workflowTrigger(workflow, triggerId);
  const descriptor = normalizeWorkflowTriggerInput(trigger.input);
  if (descriptor.kind !== "artifact") throw new Error(`Workflow ${workflowId} does not accept artifact input.`);
  if (!(file instanceof File)) throw new Error("file is required.");
  if (descriptor.maxBytes && file.size > descriptor.maxBytes) {
    throw new Error(`${file.name} exceeds the ${descriptor.maxBytes} byte limit.`);
  }
  if (descriptor.accept?.length && !descriptor.accept.some((accept) => artifactTypeAccepted(file, accept))) {
    throw new Error(`${file.name} is not an accepted file type.`);
  }
  mkdirSync(uploadRoot, { recursive: true });
  const path = join(uploadRoot, `${randomUUID()}-${safeUploadName(file.name)}`);
  await Bun.write(path, file);
  return {
    label: typeof form.get("label") === "string" ? form.get("label") as string : "attachment",
    mediaType: file.type || "application/octet-stream",
    name: file.name,
    path,
    size: file.size,
  };
}

function workflowTrigger(
  workflow: ReturnType<WorkflowApp["listWorkflows"]>[number],
  requested: unknown,
) {
  const triggerId = typeof requested === "string" ? requested : workflow.triggers[0]?.id;
  const trigger = workflow.triggers.find((item) => item.id === triggerId);
  if (!trigger) throw new Error(`Unknown trigger ${String(triggerId)} for workflow ${workflow.id}.`);
  return trigger;
}

function artifactTypeAccepted(file: File, accept: string) {
  if (accept.startsWith(".")) return file.name.toLowerCase().endsWith(accept.toLowerCase());
  if (accept.endsWith("/*")) return file.type.startsWith(accept.slice(0, -1));
  return file.type === accept;
}

function safeUploadName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function asset(body: string, contentType: string) {
  return new Response(body, {
    headers: responseHeaders(`${contentType}; charset=utf-8`),
  });
}

function responseHeaders(contentType: string) {
  return {
    "cache-control": "no-store",
    "content-type": contentType,
  };
}
