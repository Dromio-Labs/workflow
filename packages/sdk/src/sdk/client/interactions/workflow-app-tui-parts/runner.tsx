/** @jsxImportSource @opentui/solid */
import { artifactEnd } from "../workflow-app-artifacts.js";
import { WorkflowAppTuiShell } from "../workflow-app-tui.impl.js";
import { normalizeWorkflowTuiKeymap, type RunWorkflowTuiAppOptions } from "../workflow-app-tui.js";
import { createWorkflowAppRuntime, type WorkflowApp } from "../workflow-app.js";
import { formatWorkflowTuiExitSummary } from "./exit-summary.js";
import { resetTerminalInputModes } from "./native-io.js";
import { isWorkflowTuiImmediateExitSequence, propsOnInterrupt } from "./runtime-utils.js";
import { TUI_NAME } from "./style.js";
import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";

export async function runWorkflowTuiApp(
  app: WorkflowApp,
  options: RunWorkflowTuiAppOptions = {},
) {
  const commandName = options.commandName ?? TUI_NAME;
  const artifactDirectory = options.artifactDirectory === false
    ? undefined
    : options.artifactDirectory ?? ".dromio/runs";
  const runtime = options.runtime ?? createWorkflowAppRuntime(app, {
    endHooks: artifactDirectory
      ? [artifactEnd.file({ directory: artifactDirectory })]
      : [],
  });
  let interrupted = false;
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  let finished = false;
  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const close = () => {
    if (finished) return;
    finished = true;
    process.off("SIGINT", handleSigint);
    renderer?.setTerminalTitle("");
    renderer?.destroy();
    resetTerminalInputModes();
    resolveDone?.();
  };
  const interrupt = () => {
    if (interrupted) return;
    interrupted = true;
    close();
    void propsOnInterrupt(options);
  };
  function handleSigint() {
    interrupt();
  }
  process.once("SIGINT", handleSigint);
  renderer = await createCliRenderer({
    autoFocus: true,
    debounceDelay: 8,
    exitOnCtrlC: false,
    externalOutputMode: "passthrough",
    gatherStats: false,
    onDestroy: close,
    openConsoleOnError: false,
    prependInputHandlers: [(sequence) => {
      if (!isWorkflowTuiImmediateExitSequence(sequence)) return false;
      interrupt();
      return true;
    }],
    targetFps: 60,
    useKittyKeyboard: {},
    useMouse: true,
  });
  renderer.setTerminalTitle(commandName);

  await render(() => (
    <WorkflowAppTuiShell
      app={app}
      commandName={commandName}
      defaultPrompt={options.defaultPrompt}
      emptyAnswerHint={options.emptyAnswerHint}
      exportWorkflows={options.exportWorkflows}
      initialRunId={options.initialRunId}
      initialWorkflowId={options.initialWorkflowId}
      onExit={interrupt}
      runtime={runtime}
      controlPlane={options.controlPlane}
      keymap={normalizeWorkflowTuiKeymap(options.keymap)}
    />
  ), renderer);

  await done;
  if (options.showExitSummary !== false) {
    const summary = formatWorkflowTuiExitSummary(app, runtime.listRuns().at(-1));
    if (summary) (options.output ?? process.stdout).write(summary);
  }
}
