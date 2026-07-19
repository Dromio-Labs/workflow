import {
  isWorkflowApp,
  createWorkflowApp,
} from "./app.js";
import {
  formatUnknownWorkflowMessage,
  parseWorkflowCliArgs,
  resolveWorkflowAppStartInput,
} from "./commands.js";
import {
  formatWorkflowAppResult,
} from "./runtime.js";
import type {
  RunWorkflowAppOptions,
  RunWorkflowCliAppOptions,
  RunnableWorkflowAppWorkflow,
  WorkflowApp,
  WorkflowAppConfig,
  WorkflowAppEntry,
  WorkflowAppSession,
} from "./types.js";
import type {
  RunnableTerminalWorkflow,
} from "../terminal-workflow.js";
import type {
  TerminalQuestionInput,
} from "../terminal-questions.js";

export async function runWorkflowApp(
  appOrConfig: WorkflowApp | WorkflowAppConfig | WorkflowAppEntry["workflow"],
  options: RunWorkflowAppOptions = {},
) {
  const app = isWorkflowApp(appOrConfig) ? appOrConfig : createWorkflowApp(appOrConfig);
  const mode = options.mode ?? "auto";
  const input = options.cli?.input ?? process.stdin;
  const output = options.cli?.output ?? process.stdout;
  const argv = options.cli?.argv ?? process.argv.slice(2);
  const args = parseWorkflowCliArgs(app, argv);
  if (args.error) {
    output.write(`${args.error}\n`);
    return undefined;
  }
  if (args.workflowId && !app.workflowIds().includes(args.workflowId)) {
    output.write(formatUnknownWorkflowMessage(app, args.workflowId));
    return undefined;
  }
  const useCli = mode === "cli" ||
    (mode === "auto" && (argvRequestsCli(app, argv) || !input.isTTY || !output.isTTY));
  if (useCli) {
    return runWorkflowCliApp(app, {
      ...options.cli,
      argv,
      defaultPrompt: options.cli?.defaultPrompt ?? options.defaultPrompt,
      input,
      output,
    });
  }
  const { runWorkflowTuiApp } = await import("../workflow-app-tui.js");
  return runWorkflowTuiApp(app, {
    ...options.tui,
    defaultPrompt: options.tui?.defaultPrompt ?? options.defaultPrompt,
    initialRunId: options.tui?.initialRunId ?? args.sessionId,
    initialWorkflowId: options.tui?.initialWorkflowId ?? args.workflowId,
  });
}

export async function runWorkflowCliApp(
  app: WorkflowApp,
  options: RunWorkflowCliAppOptions = {},
) {
  const output = options.output ?? process.stdout;
  const input = options.input ?? process.stdin;
  const args = parseWorkflowCliArgs(app, options.argv ?? process.argv.slice(2));
  if (args.error) {
    output.write(`${args.error}\n`);
    return undefined;
  }
  const requestedWorkflowId = args.workflowId ?? app.defaultWorkflowId;
  if (!app.workflowIds().includes(requestedWorkflowId)) {
    output.write(formatUnknownWorkflowMessage(app, requestedWorkflowId));
    return undefined;
  }
  const prompt = args.prompt || await readPromptFromInput(input) || options.defaultPrompt || "";
  if (!prompt.trim()) {
    output.write("Input is required. Pass a prompt argument or pipe input on stdin.\n");
    return undefined;
  }
  const { input: resolvedPrompt, workflowId } = resolveWorkflowAppStartInput(app, {
    input: prompt,
    workflowId: requestedWorkflowId,
  });
  const entry = app.getWorkflow(workflowId);
  const interactive = options.interactive ?? args.interactive ?? false;
  const { runTerminalWorkflow } = await import("../terminal-workflow.js");
  return runTerminalWorkflow(entry.workflow as RunnableTerminalWorkflow<string, WorkflowAppSession>, {
    emptyAnswerHint: options.emptyAnswerHint,
    formatResult: (session) => formatWorkflowAppResult(entry, session as WorkflowAppSession),
    input: resolvedPrompt,
    inputStream: input,
    interactive,
    maxNonInteractiveAutoAnswers: options.maxNonInteractiveAutoAnswers,
    output,
    renderer: options.renderer ?? "log",
  });
}

function argvRequestsCli(app: WorkflowApp, argv: string[]) {
  if (argv.includes("--cli")) return true;
  return Boolean(parseWorkflowCliArgs(app, argv).prompt);
}

async function readPromptFromInput(input: TerminalQuestionInput) {
  if (input.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}
