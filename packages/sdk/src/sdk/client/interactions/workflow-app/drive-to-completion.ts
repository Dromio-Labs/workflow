import {
  answerTerminalQuestions,
  TerminalQuestionDefaultUnavailableError,
  terminalQuestionSignature,
  type TerminalQuestionOptions,
} from "../terminal-questions.js";
import type {
  WorkflowAppRuntime,
} from "./types.js";

export async function driveWorkflowAppRunToCompletion(
  runtime: WorkflowAppRuntime,
  runId: string,
  options: TerminalQuestionOptions = {},
) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const interactive = options.interactive ?? Boolean(input.isTTY && output.isTTY);
  const seenNonInteractiveWaits = new Set<string>();
  let autoAnswers = 0;
  let run = runtime.getRun(runId);
  while (run.session.status === "waiting" && run.session.pendingQuestions.length > 0) {
    if (!interactive) {
      autoAnswers += run.session.pendingQuestions.length;
      if (autoAnswers > (options.maxNonInteractiveAutoAnswers ?? 25)) break;
      const signature = terminalQuestionSignature(run.session, options);
      if (seenNonInteractiveWaits.has(signature)) break;
      seenNonInteractiveWaits.add(signature);
    }
    try {
      await answerTerminalQuestions(run.session, {
        ...options,
        input,
        interactive,
        output,
      });
    } catch (error) {
      if (!interactive && error instanceof TerminalQuestionDefaultUnavailableError) break;
      throw error;
    }
    run = await runtime.resumeRun(runId);
  }
  return run;
}
