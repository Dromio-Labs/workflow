import {
  createWorkflowAppRuntime,
  formatWorkflowAppResult,
} from "./runtime.js";
import {
  driveWorkflowAppRunToCompletion,
} from "./drive-to-completion.js";
import {
  createWorkflowTaskReporter,
} from "./task-reporter.js";
import type {
  RunWorkflowAppCliOptions,
  RunWorkflowAppCliResultOptions,
  WorkflowAppCliDefinition,
  WorkflowAppCliReporter,
  WorkflowAppCliResult,
  WorkflowTaskReporterPreset,
} from "./types.js";

export function defineWorkflowAppCli<TInput>(
  input: WorkflowAppCliDefinition<TInput>,
): WorkflowAppCliDefinition<TInput> {
  return input;
}

export async function runWorkflowAppCli<TInput>(
  cli: WorkflowAppCliDefinition<TInput>,
  options: RunWorkflowAppCliOptions = {},
): Promise<WorkflowAppCliResult> {
  const result = await runWorkflowAppCliResult(cli, options);
  if (options.exit !== false) {
    process.exit(result.exitCode);
  }
  return result;
}

export async function runWorkflowAppCliResult<TInput>(
  cli: WorkflowAppCliDefinition<TInput>,
  options: RunWorkflowAppCliResultOptions = {},
): Promise<WorkflowAppCliResult> {
  const argv = options.argv ?? process.argv.slice(2);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const reporter = resolveReporter(cli.reporter);
  const usage = usageText(cli);
  const startedAt = performance.now();

  try {
    for (const loadEnv of cli.env ?? []) loadEnv();
    const parsedInput = cli.parseArgs(argv);
    reporter.onStart?.({
      argv,
      cli,
      input: parsedInput,
      stderr,
      stdout,
      workflowId: cli.workflowId,
    });
    const runtime = createWorkflowAppRuntime(cli.app, {
      endHooks: cli.endHooks,
    });
    let run = await runtime.startRun({
      input: cli.encodeInput(parsedInput),
      onEvent(event) {
        reporter.onEvent?.(event);
      },
      origin: typeof cli.origin === "function" ? cli.origin(parsedInput) : cli.origin,
      workflowId: cli.workflowId,
    });
    run = await driveWorkflowAppRunToCompletion(runtime, run.runId, {
      input: options.input,
      interactive: options.interactive,
      output: stdout,
    });
    const formattedResult = formatWorkflowAppResult(cli.app.getWorkflow(run.workflowId), run.session);
    reporter.onComplete?.({
      argv,
      cli,
      durationMs: elapsedMs(startedAt),
      formattedResult,
      input: parsedInput,
      run,
      stderr,
      stdout,
      workflowId: run.workflowId,
    });
    return {
      exitCode: run.status === "completed" ? 0 : 1,
      run,
    };
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    reporter.onError?.({
      argv,
      cli,
      error: normalized,
      stderr,
      stdout,
      usage,
      workflowId: cli.workflowId,
    });
    return {
      error: normalized,
      exitCode: 1,
    };
  }
}

function resolveReporter(
  reporter: WorkflowAppCliReporter | WorkflowTaskReporterPreset | undefined,
): WorkflowAppCliReporter {
  if (!reporter || reporter === "compact") return createWorkflowTaskReporter();
  if (reporter === "none") return {};
  return reporter;
}

function usageText(cli: { usage?: string | (() => string) }): string | undefined {
  if (!cli.usage) return undefined;
  return typeof cli.usage === "function" ? cli.usage() : cli.usage;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
