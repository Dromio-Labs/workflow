import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeWorkflowTriggerSubmission,
  isJsonValue,
  normalizeWorkflowTriggerInput,
  type WorkflowTriggerDescriptor,
  type WorkflowTriggerInputDescriptor,
} from "@dromio/workflow-room-protocol";
import type { EventRecord } from "../../core/index.js";
import {
  projectWorkflowGraphRenderModel,
  type WorkflowRenderModel,
} from "../workflow-render/index.js";
import { workflowFieldLayout } from "../workflow-field-svg/index.js";
import {
  createWorkflowAppRuntime,
  snapshotWorkflowAppRun,
} from "./workflow-app/runtime.js";
import type {
  WorkflowApp,
  WorkflowAppRun,
} from "./workflow-app/types.js";
import {
  renderWorkflowSvgAppPage,
  workflowSvgAppStyles,
} from "./workflow-app-svg/page.js";
import { serializeWorkflowBrowserShellBuild } from "./workflow-browser-shell-build.js";

export type WorkflowSvgAppTrigger = Omit<WorkflowTriggerDescriptor, "input"> & {
  input: WorkflowTriggerInputDescriptor;
};

export type WorkflowSvgAppWorkflow = {
  defaultInput?: string;
  description?: string;
  id: string;
  model: WorkflowRenderModel;
  stepCount: number;
  title: string;
  trigger: WorkflowSvgAppTrigger;
};

export type WorkflowSvgAppPayload = {
  appId: string;
  defaultWorkflowId: string;
  title: string;
  workflows: WorkflowSvgAppWorkflow[];
};

export type RunWorkflowAppSvgOptions = {
  defaultInput?: string;
  hostname?: string;
  port?: number;
  stdout?: { write(chunk: string): unknown };
};

export type WorkflowAppSvgServer = {
  hostname: string;
  port: number;
  stop(): void;
  url: string;
};

type WorkflowSvgStreamMessage =
  | { event: EventRecord; type: "event" }
  | { error: string; type: "error" }
  | { run: ReturnType<typeof snapshotWorkflowAppRun>; type: "run" };

let workflowSvgShellScript: Promise<string> | undefined;

export function createWorkflowSvgAppPayload(
  app: WorkflowApp,
  options: Pick<RunWorkflowAppSvgOptions, "defaultInput"> = {},
): WorkflowSvgAppPayload {
  const defaultInput = options.defaultInput?.trim();
  return {
    appId: app.id,
    defaultWorkflowId: app.defaultWorkflowId,
    title: app.title,
    workflows: app.listWorkflows().map((workflow) => {
      const triggers = workflow.triggers.map((trigger) => normalizedTrigger(trigger, defaultInput));
      const model = projectWorkflowGraphRenderModel({
        entryTriggers: triggers,
        graph: app.graph(workflow.id),
      });
      return {
        ...(defaultInput ? { defaultInput } : {}),
        ...(workflow.description ? { description: workflow.description } : {}),
        id: workflow.id,
        model,
        stepCount: workflowFieldLayout(model).boxes.filter((box) =>
          !box.kind.endsWith("group") && box.kind !== "initial"
        ).length,
        title: workflow.title,
        trigger: triggers[0]!,
      };
    }),
  };
}

export function runWorkflowAppSvg(
  app: WorkflowApp,
  options: RunWorkflowAppSvgOptions = {},
): WorkflowAppSvgServer {
  const hostname = options.hostname ?? "127.0.0.1";
  const payload = createWorkflowSvgAppPayload(app, options);
  const runtime = createWorkflowAppRuntime(app);
  const runEventSinks = new Map<string, (event: EventRecord) => void>();
  const server = Bun.serve({
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      try {
        if (pathname === "/") return asset(renderWorkflowSvgAppPage(payload), "text/html");
        if (pathname === "/app.css") return asset(workflowSvgAppStyles, "text/css");
        if (pathname === "/shell.js") return asset(await browserShellScript(), "text/javascript");
        if (pathname === "/api/workflows") return json(payload);
        if (pathname === "/api/runs" && request.method === "POST") {
          const body = await runStartBody(app, request);
          return streamRun(app, async (send) => {
            let initialSink: ((event: EventRecord) => void) | undefined = (event) => send({ event, type: "event" });
            const completed = await runtime.startRun({
              input: body.input,
              onEvent(event) {
                (runEventSinks.get(event.runId) ?? initialSink)?.(event);
              },
              triggerId: body.triggerId,
              workflowId: body.workflowId,
            });
            initialSink = undefined;
            return completed;
          });
        }
        const answer = pathname.match(/^\/api\/runs\/([^/]+)\/questions\/([^/]+)$/);
        if (answer && request.method === "POST") {
          const runId = decodeURIComponent(answer[1]!);
          const questionId = decodeURIComponent(answer[2]!);
          const value = (await request.json() as { value?: unknown }).value;
          return streamRun(app, async (send) => {
            const sink = (event: EventRecord) => send({ event, type: "event" });
            runEventSinks.set(runId, sink);
            const unsubscribe = runtime.subscribe(runId, sink);
            try {
              await runtime.answerQuestion(runId, { questionId, value });
              return await runtime.resumeRun(runId);
            } finally {
              runEventSinks.delete(runId);
              unsubscribe();
            }
          });
        }
        if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
        return new Response("Not found", { status: 404 });
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400);
      }
    },
    hostname,
    port: options.port ?? 0,
  });
  const port = server.port ?? options.port ?? 0;
  const displayHost = hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
  const url = `http://${displayHost}:${port}`;
  (options.stdout ?? process.stdout).write(`${app.title} SVG: ${url}\n`);
  return {
    hostname,
    port,
    stop() {
      void server.stop(true);
    },
    url,
  };
}

function normalizedTrigger(trigger: WorkflowTriggerDescriptor, defaultInput?: string): WorkflowSvgAppTrigger {
  const input = normalizeWorkflowTriggerInput(trigger.input);
  return {
    ...trigger,
    input: defaultInput && input.kind === "prompt" ? { ...input, defaultValue: defaultInput } : input,
  };
}

async function runStartBody(app: WorkflowApp, request: Request) {
  const body = await request.json() as { input?: unknown; triggerId?: unknown; workflowId?: unknown };
  if (typeof body.workflowId !== "string") throw new Error("workflowId is required.");
  const workflow = app.listWorkflows().find((item) => item.id === body.workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${body.workflowId}`);
  const trigger = workflow.triggers.find((item) => item.id === body.triggerId) ?? workflow.triggers[0];
  if (!trigger) throw new Error(`Workflow ${body.workflowId} has no trigger.`);
  const value = isJsonValue(body.input) ? body.input : undefined;
  const input = encodeWorkflowTriggerSubmission({ ...(value !== undefined ? { value } : {}) });
  if (normalizeWorkflowTriggerInput(trigger.input).required && !input.trim()) {
    throw new Error(`Input is required for ${workflow.title}.`);
  }
  return { input, triggerId: trigger.id, workflowId: workflow.id };
}

function streamRun(
  app: WorkflowApp,
  run: (send: (message: WorkflowSvgStreamMessage) => void) => Promise<WorkflowAppRun>,
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (message: WorkflowSvgStreamMessage) => {
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
  return new Response(stream, { headers: responseHeaders("application/x-ndjson") });
}

function browserShellScript() {
  workflowSvgShellScript ??= serializeWorkflowBrowserShellBuild(buildBrowserShellScript);
  return workflowSvgShellScript;
}

async function buildBrowserShellScript() {
  const entrypoint = resolveBrowserShellEntrypoint(
    "workflow-app-svg/shell-client.tsx",
    "workflow-app-svg-shell-client.tsx",
  );
  const build = await Bun.build({
    entrypoints: [entrypoint],
    format: "esm",
    minify: true,
    packages: "bundle",
    plugins: [{
      name: "workflow-svg-react-deduplication",
      setup(builder) {
        builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => ({
          path: Bun.resolveSync(args.path, entrypoint),
        }));
      },
    }],
    target: "browser",
  });
  if (!build.success || !build.outputs[0]) {
    throw new Error(build.logs.map((log) => log.message).join("\n") || "Unable to build workflow SVG shell.");
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

function asset(body: string, contentType: string) {
  return new Response(body, { headers: responseHeaders(`${contentType}; charset=utf-8`) });
}

function json(body: unknown) {
  return jsonResponse(body, 200);
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { headers: responseHeaders("application/json"), status });
}

function responseHeaders(contentType: string) {
  return { "cache-control": "no-store", "content-type": contentType };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
