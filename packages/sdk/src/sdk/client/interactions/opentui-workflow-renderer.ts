import type {
  LoopGraphProjection,
} from "../../core/index.js";
import type {
  TerminalQuestionOptions,
  TerminalQuestionSession,
} from "./terminal-questions.js";
import type {
  TraceStream,
} from "./trace-stream.js";
import type {
  TerminalWorkflowRenderer,
} from "./terminal-workflow-renderer.js";

export type OpenTuiWorkflowRenderer = TerminalWorkflowRenderer & {
  answerQuestions(
    session: TerminalQuestionSession,
    options: TerminalQuestionOptions,
  ): Promise<boolean>;
};

export async function createOpenTuiWorkflowRenderer(input: {
  graph: LoopGraphProjection;
  input?: unknown;
  onInterrupt?: () => void;
  stream: TraceStream;
}): Promise<OpenTuiWorkflowRenderer> {
  await import("@opentui/solid/preload");
  const implementation = await import("./opentui-workflow-renderer.impl.js");
  return implementation.createOpenTuiWorkflowRenderer(input);
}
