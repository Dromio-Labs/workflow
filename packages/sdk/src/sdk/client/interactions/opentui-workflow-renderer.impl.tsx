/** @jsxImportSource @opentui/solid */
import {
  createCliRenderer,
  parseKeypress,
  type ParsedKey,
} from "@opentui/core";
import {
  render,
} from "@opentui/solid";
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
import {
  WorkflowTuiApp,
} from "./opentui-workflow-renderer/app.js";
import {
  createQuestionDockController,
} from "./opentui-workflow-renderer/controller.js";
import {
  createWorkflowRunStore,
} from "./workflow-run-store.js";

export {
  WorkflowTuiApp,
} from "./opentui-workflow-renderer/app.js";
export {
  createQuestionDockController,
} from "./opentui-workflow-renderer/controller.js";
export type {
  QuestionDockController,
} from "./opentui-workflow-renderer/controller.js";
export {
  QuestionDock,
} from "./opentui-workflow-renderer/question-dock.js";

export type OpenTuiWorkflowRenderer = TerminalWorkflowRenderer & {
  answerQuestions(
    session: TerminalQuestionSession,
    options: TerminalQuestionOptions,
  ): Promise<boolean>;
};

type OpenTuiWorkflowRendererInternals = {
  createRenderer?: typeof createCliRenderer;
  renderApp?: typeof render;
};

export async function createOpenTuiWorkflowRenderer(input: {
  graph: LoopGraphProjection;
  input?: unknown;
  onInterrupt?: () => void;
  stream: TraceStream;
}, internals: OpenTuiWorkflowRendererInternals = {}): Promise<OpenTuiWorkflowRenderer> {
  const store = createWorkflowRunStore({
    graph: input.graph,
    input: input.input,
  });
  const questionController = createQuestionDockController();
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  const closeRenderer = () => {
    if (closed) return;
    closed = true;
    unsubscribe?.();
    store.close();
    questionController.close();
    renderer?.setTerminalTitle("");
    renderer?.destroy();
  };
  const handleInterruptSequence = (sequence: string) => {
    if (!isAppExitSequence(sequence)) return false;
    questionController.complete(false);
    closeRenderer();
    input.onInterrupt?.();
    return true;
  };
  renderer = await (internals.createRenderer ?? createCliRenderer)({
    autoFocus: true,
    exitOnCtrlC: false,
    externalOutputMode: "passthrough",
    gatherStats: false,
    openConsoleOnError: false,
    prependInputHandlers: [handleInterruptSequence],
    targetFps: 60,
    useKittyKeyboard: {},
    useMouse: true,
  });
  unsubscribe = input.stream.subscribe((update) => {
    store.push(update.event);
  });
  let renderFailed = false;

  const renderApp = internals.renderApp ?? render;
  void renderApp(() => (
    <WorkflowTuiApp
      questionController={questionController}
      store={store}
    />
  ), renderer).catch(() => {
    renderFailed = true;
    questionController.complete(false);
  });

  return {
    async answerQuestions(session, options) {
      if (renderFailed) return false;
      return questionController.ask(session, options);
    },
    close() {
      closeRenderer();
    },
    pause() {
      store.flush();
    },
    render() {
      store.flush();
    },
    resume() {
      store.flush();
    },
    snapshot() {
      return store.snapshot();
    },
  };
}

export function isAppExitSequence(sequence: string) {
  const key = parseKeypress(Buffer.from(sequence), { useKittyKeyboard: true });
  return isAppExitKey(key);
}

function isAppExitKey(key: ParsedKey | null) {
  if (!key || key.eventType === "release") return false;
  if (!key.ctrl || key.meta || key.shift || key.option || key.super || key.hyper) return false;
  const name = key.name.toLowerCase();
  return name === "c" || name === "d";
}
