import type {
  EventSink,
  LoopGraphProjection,
} from "../../core/index.js";
import {
  answerTerminalQuestions,
  TerminalQuestionDefaultUnavailableError,
  terminalQuestionSignature,
  type TerminalQuestionOptions,
  type TerminalQuestionInput,
  type TerminalQuestionOutput,
  type TerminalQuestionSession,
} from "./terminal-questions.js";
import {
  createTerminalTraceRenderer,
} from "./terminal-trace-renderer.js";
import {
  createTraceStream,
} from "./trace-stream.js";
import {
  createTerminalWorkflowRenderer,
  type TerminalWorkflowRenderer,
} from "./terminal-workflow-renderer.js";
import {
  createOpenTuiWorkflowRenderer,
  type OpenTuiWorkflowRenderer,
} from "./opentui-workflow-renderer.js";

export type TerminalWorkflowSession = TerminalQuestionSession & {
  answers?: Record<string, unknown>;
  pendingHooks?: Array<{
    id: string;
    kind?: string;
    stepId: string;
    token: string;
  }>;
  runId: string;
  state?: unknown;
};

export type RunnableTerminalWorkflow<TInput, TSession extends TerminalWorkflowSession> = {
  graph(): LoopGraphProjection;
  id: string;
  start(input: TInput, options?: {
    answers?: Record<string, unknown>;
    onEvent?: EventSink;
    questionResolvers?: unknown;
    runId?: string;
  }): Promise<TSession> | TSession;
};

export type RunTerminalWorkflowOptions<TInput> = {
  answers?: Record<string, unknown>;
  color?: boolean;
  emptyAnswerHint?: false | string;
  formatResult?: (session: TerminalWorkflowSession) => string | undefined;
  input: TInput;
  inputStream?: TerminalQuestionInput;
  interactive?: boolean;
  maxNonInteractiveAutoAnswers?: number;
  onEvent?: EventSink;
  output?: TerminalQuestionOutput;
  questionResolvers?: unknown;
  renderer?: "auto" | "dashboard" | "log" | "none" | "tui";
  runId?: string;
  showResult?: boolean;
  tuiRendererFactory?: typeof createOpenTuiWorkflowRenderer;
};

export async function runTerminalWorkflow<
  TInput,
  TSession extends TerminalWorkflowSession,
>(
  workflow: RunnableTerminalWorkflow<TInput, TSession>,
  options: RunTerminalWorkflowOptions<TInput>,
): Promise<TSession> {
  const output = options.output ?? process.stdout;
  const stream = createTraceStream();
  const rendererMode = options.renderer ?? "auto";
  const useTui = rendererMode === "tui" ||
    (rendererMode === "auto" && options.output === undefined && Boolean(output.isTTY));
  const useDashboard = rendererMode === "dashboard" ||
    (rendererMode === "auto" && !useTui && Boolean(output.isTTY));
  const useLog = rendererMode === "log" ||
    (rendererMode === "auto" && !output.isTTY);

  let workflowRenderer: (TerminalWorkflowRenderer | OpenTuiWorkflowRenderer) | undefined;
  let traceRenderer: ReturnType<typeof createTerminalTraceRenderer> | undefined;
  let interrupted = false;
  const interrupt = () => {
    if (interrupted) return;
    interrupted = true;
    workflowRenderer?.close();
    traceRenderer?.close();
    restoreTerminalAfterInterrupt(output);
    if (output.isTTY) output.write("\n");
    output.write("Interrupted.\n");
    setTimeout(() => process.exit(130), 25);
  };
  const removeSigintHandler = output.isTTY ? installInterruptSignalHandler(interrupt) : () => {};

  if (useTui) {
    try {
      workflowRenderer = await (options.tuiRendererFactory ?? createOpenTuiWorkflowRenderer)({
        graph: workflow.graph(),
        input: options.input,
        onInterrupt: interrupt,
        stream,
      });
    } catch {
      if (output.isTTY) {
        workflowRenderer = createTerminalWorkflowRenderer({
          color: options.color ?? Boolean(output.isTTY),
          graph: workflow.graph(),
          input: options.input,
          output,
          stream,
        });
      } else {
        traceRenderer = createTerminalTraceRenderer({
          color: options.color ?? Boolean(output.isTTY),
          output,
          spinner: true,
          stream,
        });
      }
    }
  } else if (useDashboard) {
    workflowRenderer = createTerminalWorkflowRenderer({
      color: options.color ?? Boolean(output.isTTY),
      graph: workflow.graph(),
      input: options.input,
      output,
      stream,
    });
  } else if (useLog) {
    traceRenderer = createTerminalTraceRenderer({
      color: options.color ?? Boolean(output.isTTY),
      output,
      spinner: true,
      stream,
    });
  }

  let session: TSession;
  try {
    session = await workflow.start(options.input, {
      answers: options.answers,
      onEvent(event) {
        stream.push(event);
        void options.onEvent?.(event);
      },
      questionResolvers: options.questionResolvers,
      runId: options.runId,
    });

    const interactive = terminalQuestionsAreInteractive(options, output);
    const seenNonInteractiveWaits = new Set<string>();
    let nonInteractiveAutoAnswers = 0;
    while (session.status === "waiting") {
      if (session.pendingQuestions.length === 0) {
        workflowRenderer?.pause();
        writePendingHookWait(output, session);
        break;
      }
      if (!interactive) {
        nonInteractiveAutoAnswers += session.pendingQuestions.length;
        if (nonInteractiveAutoAnswers > (options.maxNonInteractiveAutoAnswers ?? 25)) {
          workflowRenderer?.pause();
          writeNoForwardProgressWait(output, session);
          break;
        }
        const signature = terminalQuestionSignature(session, questionOptions(options, output, interactive));
        if (seenNonInteractiveWaits.has(signature)) {
          workflowRenderer?.pause();
          writeNoForwardProgressWait(output, session);
          break;
        }
        seenNonInteractiveWaits.add(signature);
      }
      const questionRenderer = rendererWithQuestionAnswering(workflowRenderer);
      const rendererAnswered = interactive && questionRenderer
        ? await questionRenderer.answerQuestions(session, questionOptions(options, output, interactive))
        : false;
      if (interrupted) {
        break;
      }
      if (!rendererAnswered) {
        workflowRenderer?.pause();
        try {
          await answerTerminalQuestions(session, questionOptions(options, output, interactive));
        } catch (error) {
          if (error instanceof TerminalQuestionDefaultUnavailableError) {
            writeUnansweredQuestionWait(output, error);
            break;
          }
          throw error;
        }
        workflowRenderer?.resume();
      }
      await session.resume();
    }
  } finally {
    removeSigintHandler();
    workflowRenderer?.close();
    traceRenderer?.close();
  }

  if (!interrupted && options.showResult !== false && session.status !== "waiting") {
    output.write("\nResult\n");
    output.write(`${formatTerminalWorkflowResult(session, options)}\n`);
  }

  return session;
}

function formatTerminalWorkflowResult<TInput>(
  session: TerminalWorkflowSession,
  options: RunTerminalWorkflowOptions<TInput>,
) {
  return options.formatResult?.(session) ?? JSON.stringify(session.state ?? {}, null, 2);
}

function installInterruptSignalHandler(onInterrupt: () => void) {
  const handler = () => onInterrupt();
  process.once("SIGINT", handler);
  return () => {
    process.removeListener("SIGINT", handler);
  };
}

function restoreTerminalAfterInterrupt(output: TerminalQuestionOutput) {
  if (!output.isTTY) return;
  const stdin = process.stdin;
  try {
    if (stdin.isTTY && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(false);
    }
  } catch {
    // Best-effort cleanup before exiting.
  }
  output.write("\u001b[?1000l\u001b[?1002l\u001b[?1003l\u001b[?1006l\u001b[?1015l\u001b[?25h\u001b[0m");
}

function rendererWithQuestionAnswering(
  renderer: (TerminalWorkflowRenderer | OpenTuiWorkflowRenderer) | undefined,
): OpenTuiWorkflowRenderer | undefined {
  if (!renderer || !("answerQuestions" in renderer)) return undefined;
  return renderer;
}

function writePendingHookWait(
  output: TerminalQuestionOutput,
  session: TerminalWorkflowSession,
) {
  const hooks = session.pendingHooks ?? [];
  output.write("\nWaiting\n");
  if (hooks.length === 0) {
    output.write("Workflow is waiting, but no terminal-answerable question is pending.\n");
    return;
  }
  output.write("Workflow is waiting on a non-question hook that this terminal adapter cannot answer directly.\n");
  for (const hook of hooks) {
    output.write(`- ${hook.stepId}: ${hook.id}${hook.kind ? ` (${hook.kind})` : ""}\n`);
  }
}

function writeUnansweredQuestionWait(
  output: TerminalQuestionOutput,
  error: TerminalQuestionDefaultUnavailableError,
) {
  output.write("\nWaiting\n");
  output.write(`Cannot auto-answer ${error.question.title ?? error.question.id}: ${error.message}\n`);
}

function writeNoForwardProgressWait(
  output: TerminalQuestionOutput,
  session: TerminalWorkflowSession,
) {
  output.write("\nWaiting\n");
  output.write("Cannot advance non-interactive answers for the pending questions.\n");
  for (const question of session.pendingQuestions) {
    output.write(`- ${question.title ?? question.id}: ${question.prompt}\n`);
  }
}

function questionOptions<TInput>(
  options: RunTerminalWorkflowOptions<TInput>,
  output: TerminalQuestionOutput,
  interactive = terminalQuestionsAreInteractive(options, output),
): TerminalQuestionOptions {
  return {
    emptyAnswerHint: options.emptyAnswerHint ?? "Press Enter to let the workflow make a sensible assumption.",
    input: options.inputStream,
    interactive,
    maxNonInteractiveAutoAnswers: options.maxNonInteractiveAutoAnswers,
    output,
  };
}

function terminalQuestionsAreInteractive<TInput>(
  options: RunTerminalWorkflowOptions<TInput>,
  output: TerminalQuestionOutput,
) {
  const input = options.inputStream ?? process.stdin;
  return options.interactive ?? Boolean(input.isTTY && output.isTTY);
}
