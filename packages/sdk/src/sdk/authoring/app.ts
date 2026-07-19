import {
  createWorkflowApp,
} from "../client/interactions/workflow-app/app.js";
import {
  runWorkflowApp,
  runWorkflowCliApp,
} from "../client/interactions/workflow-app/cli.js";
import {
  runWorkflowAppCliResult,
} from "../client/interactions/workflow-app/cli-runner.js";
import {
  formatUnknownWorkflowMessage,
  parseWorkflowCliArgs,
} from "../client/interactions/workflow-app/commands.js";
import { createWorkflowTaskReporter } from "../client/interactions/workflow-app/task-reporter.js";
import {
  runWorkflowAppGui,
  type RunWorkflowAppGuiOptions,
} from "../client/interactions/workflow-app-gui.js";
import {
  runWorkflowAppSvg,
  type RunWorkflowAppSvgOptions,
} from "../client/interactions/workflow-app-svg.js";
import type {
  RunWorkflowAppCliResultOptions,
  RunWorkflowAppOptions,
  RunnableWorkflowAppWorkflow,
  WorkflowApp,
  WorkflowAppCliResult,
  WorkflowAppSession,
} from "../client/interactions/workflow-app/types.js";
import type { AuthoredWorkflow } from "./workflow.js";
import type { QuestionResolverRegistry } from "../core/index.js";
import type { WorkflowTriggerDescriptor } from "@dromio/workflow-room-protocol";
import type { SignalDefinition, SignalDescriptor } from "./signal.js";
import {
  createWorkflowAppHost,
  runWorkflowServer,
  type WorkflowAppHostStorage,
} from "./host.js";

export type AuthoredWorkflowAppDefinition = {
  defaultWorkflowId: string;
  id: string;
  title: string;
  type: "workflow-app";
  signals: SignalDescriptor[];
  workflows: Array<AuthoredWorkflow["definition"]>;
};

export type AuthoredWorkflowApp = WorkflowApp & {
  readonly definition: AuthoredWorkflowAppDefinition;
  readonly workflows: readonly AuthoredWorkflow[];
  readonly signals: readonly SignalDefinition[];
};

export type AuthoredWorkflowAppInput = {
  defaultWorkflow?: AuthoredWorkflow;
  id: string;
  title?: string;
  workflows: readonly AuthoredWorkflow[];
};

/** Creates an executable workflow surface for CLI, TUI, or host adapters. */
export function workflowApp(input: AuthoredWorkflowAppInput): AuthoredWorkflowApp {
  if (input.workflows.length === 0) {
    throw new Error("workflowApp requires at least one workflow.");
  }
  const defaultWorkflow = input.defaultWorkflow ?? input.workflows[0]!;
  if (!input.workflows.includes(defaultWorkflow)) {
    throw new Error(
      `Default workflow ${defaultWorkflow.id} is not registered in workflow app ${input.id}.`,
    );
  }
  const title = input.title ?? input.id;
  const signals = appSignals(input.workflows);
  const runtime = createWorkflowApp({
    defaultWorkflow: defaultWorkflow.id,
    id: input.id,
    title,
    workflows: Object.fromEntries(input.workflows.map((item) => [
      item.id,
      {
        description: item.definition.description,
        input: authoredWorkflowTriggers(item)[0]?.input,
        result: { format: formatWorkflowResult(item) },
        title: item.definition.title,
        triggers: authoredWorkflowTriggers(item),
        workflow: workflowForApp(item),
        workspace: item.workspace,
      },
    ])),
  });
  return Object.assign(runtime, {
    definition: {
      defaultWorkflowId: defaultWorkflow.id,
      id: input.id,
      title,
      type: "workflow-app" as const,
      signals: signals.map((signal) => signal.descriptor),
      workflows: input.workflows.map((item) => item.definition),
    },
    signals,
    workflows: input.workflows,
  });
}

function appSignals(workflows: readonly AuthoredWorkflow[]): SignalDefinition[] {
  const byId = new Map<string, SignalDefinition>();
  for (const signal of workflows.flatMap((workflow) => [...workflow.signals])) {
    const existing = byId.get(signal.id);
    if (
      existing
      && existing.descriptor.contractFingerprint
        !== signal.descriptor.contractFingerprint
    ) {
      throw new Error(
        `Workflow app signal ${signal.id} has conflicting correlation or payload contracts.`,
      );
    }
    byId.set(signal.id, existing ?? signal);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function authoredWorkflowTriggers(workflow: AuthoredWorkflow): WorkflowTriggerDescriptor[] {
  if (workflow.triggers.length) return [...workflow.triggers];
  return [{
    id: workflow.document.trigger.id,
    input: { kind: "prompt", required: true },
    label: workflow.document.trigger.label ?? "Prompt",
    type: "manual",
  }];
}

function workflowForApp(
  workflow: AuthoredWorkflow,
): RunnableWorkflowAppWorkflow<string, WorkflowAppSession> {
  return {
    graph: () => workflow.graph(),
    hydrate(snapshot, options) {
      return workflow.hydrate({
        ...snapshot,
        input: promptWorkflowInput(workflow, snapshot.input),
      }, options);
    },
    id: workflow.id,
    start(input, options) {
      return workflow.start(promptWorkflowInput(workflow, input), {
        ...options,
        questionResolvers: questionResolvers(options?.questionResolvers),
      });
    },
  };
}

function questionResolvers(value: unknown): QuestionResolverRegistry | undefined {
  if (value === undefined) return undefined;
  if (
    value && typeof value === "object" && !Array.isArray(value)
    && Object.values(value).every((resolver) => typeof resolver === "function")
  ) {
    return value as QuestionResolverRegistry;
  }
  throw new Error("Workflow app question resolvers must be a record of resolver functions.");
}

function promptWorkflowInput(workflow: AuthoredWorkflow, prompt: string) {
  const keys = Object.keys(workflow.input);
  if (keys.length !== 1) {
    throw new Error(
      `CLI/TUI prompt input requires workflow ${workflow.id} to expose exactly one trigger input key.`,
    );
  }
  return { [keys[0]!]: prompt };
}

export type RunWorkflowCliOptions = RunWorkflowAppCliResultOptions & {
  exit?: boolean;
};

export type RunWorkflowGuiOptions = Omit<
  RunWorkflowAppGuiOptions,
  "onRun" | "onStop" | "runtime" | "signalFetch"
> & {
  signals?: { storage?: WorkflowAppHostStorage };
};
export type RunWorkflowSvgOptions = RunWorkflowAppSvgOptions;
export type RunWorkflowTuiOptions = NonNullable<RunWorkflowAppOptions["tui"]> & {
  signals?: {
    hostname?: string;
    listen?: boolean;
    port?: number;
    storage?: WorkflowAppHostStorage;
  };
};

export async function runWorkflowGui(
  authoredApp: AuthoredWorkflowApp,
  options: RunWorkflowGuiOptions = {},
) {
  const { signals, ...gui } = options;
  if (authoredApp.signals.length === 0) return runWorkflowAppGui(authoredApp, gui);
  const host = await createWorkflowAppHost(authoredApp, {
    storage: signals?.storage,
  });
  return runWorkflowAppGui(authoredApp, {
    ...gui,
    async onRun(run) {
      await host.persistRun(run);
      await host.deliverSignals();
    },
    runtime: host.runtime,
    async signalFetch(request) {
      const response = await host.fetch(request);
      await host.deliverSignals();
      return response;
    },
  });
}

export function runWorkflowSvg(
  authoredApp: AuthoredWorkflowApp,
  options: RunWorkflowSvgOptions = {},
) {
  return runWorkflowAppSvg(authoredApp, options);
}

export async function runWorkflowCli(
  authoredApp: AuthoredWorkflowApp,
  options: RunWorkflowCliOptions = {},
): Promise<WorkflowAppCliResult> {
  const argv = options.argv ?? process.argv.slice(2);
  const surfaceArgs = parseWorkflowSurfaceArgs(argv);
  if (surfaceArgs.listWorkflows) {
    const output = options.stdout ?? process.stdout;
    output.write(formatWorkflowList(authoredApp));
    return finishWorkflowCli({ exitCode: 0 }, options);
  }
  const parsed = parseWorkflowCliArgs(authoredApp, surfaceArgs.argv);
  if (parsed.error) {
    return workflowCliUsageError(parsed.error, options);
  }
  const workflowId = parsed.workflowId ?? authoredApp.defaultWorkflowId;
  if (!authoredApp.workflowIds().includes(workflowId)) {
    return workflowCliUsageError(
      formatUnknownWorkflowMessage(authoredApp, workflowId).trimEnd(),
      options,
    );
  }
  if (!parsed.prompt) {
    return workflowCliUsageError("A prompt is required.", options);
  }
  if (surfaceArgs.verbose) {
    const session = await runWorkflowCliApp(authoredApp, {
      argv: [...(parsed.interactive ? ["--interactive"] : []), workflowId, parsed.prompt],
      input: options.input,
      interactive: parsed.interactive ?? options.interactive,
      output: options.stdout,
      renderer: "log",
    });
    return finishWorkflowCli({
      exitCode: session?.status === "completed" ? 0 : 1,
    }, options);
  }
  const result = await runWorkflowAppCliResult({
    app: authoredApp,
    encodeInput: (value: string) => value,
    parseArgs,
    reporter: createWorkflowTaskReporter({
      color: "auto",
      showArtifacts: true,
      showTimings: true,
      title: authoredApp.title,
    }),
    title: authoredApp.title,
    usage: workflowCliUsage,
    workflowId,
  }, {
    argv: [parsed.prompt],
    input: options.input,
    interactive: parsed.interactive ?? options.interactive,
    stderr: options.stderr,
    stdout: options.stdout,
  });
  return finishWorkflowCli(result, options);
}

export async function runWorkflowTui(
  authoredApp: AuthoredWorkflowApp,
  options: RunWorkflowTuiOptions = {},
) {
  const { signals, ...tui } = options;
  if (authoredApp.signals.length === 0 || signals?.listen === false) {
    return runWorkflowApp(authoredApp, { mode: "tui", tui });
  }
  const server = await runWorkflowServer(authoredApp, {
    hostname: signals?.hostname ?? "127.0.0.1",
    port: signals?.port ?? 4323,
    storage: signals?.storage,
  });
  (tui.output ?? process.stdout).write(`Signal ingress: ${server.url}/api/signals\n`);
  try {
    return await runWorkflowApp(authoredApp, {
      mode: "tui",
      tui: {
        ...tui,
        controlPlane: server.controlPlane,
        runtime: server.runtime,
      },
    });
  } finally {
    server.stop();
  }
}

function parseArgs(args: readonly string[]) {
  return parsePrompt(args);
}

function parsePrompt(args: readonly string[]) {
  const prompt = args.join(" ").trim();
  if (!prompt) throw new Error("A prompt is required.");
  return prompt;
}

const workflowCliUsage =
  "bun run cli [--interactive] [--verbose] [--workflow <id>] <prompt>\n" +
  "       bun run cli --list-workflows";

function parseWorkflowSurfaceArgs(argv: readonly string[]) {
  return {
    argv: argv.filter((argument) =>
      argument !== "--verbose" &&
      argument !== "--list-workflows" &&
      argument !== "--"
    ),
    listWorkflows: argv.includes("--list-workflows"),
    verbose: argv.includes("--verbose"),
  };
}

function formatWorkflowList(authoredApp: AuthoredWorkflowApp) {
  const rows = authoredApp.workflows.map((item) => {
    const defaultLabel = item.id === authoredApp.defaultWorkflowId ? " (default)" : "";
    return `  ${item.id}${defaultLabel} — ${item.definition.title}`;
  });
  return `${authoredApp.title} workflows:\n${rows.join("\n")}\n`;
}

function workflowCliUsageError(
  message: string,
  options: RunWorkflowCliOptions,
): WorkflowAppCliResult {
  const output = options.stderr ?? process.stderr;
  output.write(`${message}\n\nUsage:\n  ${workflowCliUsage}\n`);
  return finishWorkflowCli({ exitCode: 2 }, options);
}

function finishWorkflowCli(
  result: WorkflowAppCliResult,
  options: RunWorkflowCliOptions,
) {
  if (options.exit !== false) process.exitCode = result.exitCode;
  return result;
}

function formatWorkflowResult(workflow: AuthoredWorkflow) {
  return (session: WorkflowAppSession) => {
    const state = session.state;
    if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
    const output = Object.fromEntries(
      Object.keys(workflow.output).map((key) => [key, (state as Record<string, unknown>)[key]]),
    );
    return JSON.stringify(output, null, 2);
  };
}
