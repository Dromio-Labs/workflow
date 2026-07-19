import type {
  WorkflowAppArtifact,
  WorkflowAppCliWritable,
  WorkflowCliCommandDetail,
  WorkflowCliCommandStatus,
  WorkflowCliActivity,
  WorkflowCliRenderer,
  WorkflowCliRendererCommandFinish,
  WorkflowCliRendererCommandStart,
  WorkflowCliRendererComplete,
  WorkflowCliRendererError,
  WorkflowCliRendererOptions,
  WorkflowCliRendererStart,
  WorkflowCliRendererStepFinish,
  WorkflowCliRendererStepStart,
  WorkflowCliStepStatus,
} from "./types.js";

type ActiveSpinner = {
  frame: number;
  label: string;
  preview?: string;
  rendered: boolean;
  renderedLines: 0 | 1 | 2;
  timer: ReturnType<typeof setInterval> | undefined;
};

const check = "\u2713";
const cross = "\u2715";
const fallbackColumns = 100;
const spinnerFrames = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"] as const;

export function createWorkflowCliRenderer(
  options: WorkflowCliRendererOptions = {},
): WorkflowCliRenderer {
  const showTimings = options.showTimings ?? true;
  const commandOutput = options.commandOutput ?? "summary";
  const showCommands = options.showCommands ?? commandOutput !== "hidden";
  const color = createColor(resolveColor(options.color));
  const commandsByStep = new Map<string, WorkflowCliCommandDetail[]>();
  const childCountByStep = new Map<string, number>();
  const parentByStep = new Map<string, string>();
  const stepLabelById = new Map<string, string>();
  const stepNumberById = new Map<string, string>();
  const spinner: ActiveSpinner = {
    frame: 0,
    label: "",
    preview: undefined,
    rendered: false,
    renderedLines: 0,
    timer: undefined,
  };
  let startInput: WorkflowCliRendererStart | undefined;
  let activeStepId = "";

  return {
    activity(input) {
      const stdout = startInput?.stdout;
      if (!stdout) return;
      const label = `${input.phase}: ${input.text}`;
      if (input.status === "running") {
        startSpinner(
          stdout,
          spinner,
          color,
          input.stepId ? `${input.stepId}: ${label}` : label,
          input.children?.[0],
        );
        return;
      }
      stopSpinner(stdout, spinner);
      writeActivity(stdout, input, color, activityDepth(input.stepId, parentByStep));
      if (activeStepId && input.status !== "error") {
        startSpinner(stdout, spinner, color, numberedStepLabel(activeStepId, stepNumberById, stepLabelById));
      }
    },
    complete(input) {
      stopSpinner(input.stdout, spinner);
      const status = input.run.status === "completed" ? "Completed" : "Failed";
      const statusText = input.run.status === "completed" ? color.green(status) : color.red(status);
      write(input.stdout, `\n${color.bold(statusText)} ${color.cyan(input.workflowId)}${showTimings ? ` ${color.dim(`in ${formatMs(input.durationMs)}`)}` : ""}\n`);
      const formatted = input.formattedResult.trim();
      if (formatted) write(input.stdout, `\n${formatted}\n`);
      if (options.showArtifacts ?? true) {
        write(input.stdout, `${color.bold("Artifacts:")} ${artifactSummary(input.run.artifacts)}\n`);
      }
    },
    dispose() {
      const output = startInput?.stdout;
      if (output) stopSpinner(output, spinner);
    },
    error(input) {
      stopSpinner(startInput?.stdout ?? input.stderr, spinner);
      write(input.stderr, `${color.bold(options.title ?? input.cli.title ?? input.cli.app.title)}\n\n`);
      write(input.stderr, `${color.bold(color.red("Failed"))} ${color.cyan(input.workflowId)}\n\n`);
      write(input.stderr, `${color.bold("Reason:")}\n  ${color.red(firstLine(input.error.message))}\n`);
      if (input.usage) write(input.stderr, `\n${color.bold("Usage:")}\n${input.usage}\n`);
    },
    finishCommand(input) {
      const items = commandsByStep.get(input.stepId) ?? [];
      items.push({
        command: input.command,
        output: input.output,
        status: input.status,
      });
      commandsByStep.set(input.stepId, items);
      const stdout = startInput?.stdout;
      if (stdout && input.status !== "failed") {
        const stepId = activeStepId || input.stepId;
        startSpinner(stdout, spinner, color, numberedStepLabel(stepId, stepNumberById, stepLabelById));
      }
    },
    finishStep(input) {
      const stdout = startInput?.stdout;
      if (!stdout) return;
      stopSpinner(stdout, spinner);
      write(stdout, stepLine({
        color,
        depth: input.parentStepId ? 1 : 0,
        durationMs: input.durationMs,
        label: input.label ?? (input.stepId ? stepLabelById.get(input.stepId) : undefined),
        number: input.stepId ? stepNumberById.get(input.stepId) : undefined,
        showTimings,
        status: input.status,
        stepId: input.stepId,
      }));
      writeCommandDetails(stdout, commandsByStep.get(input.stepId ?? ""), showCommands, color, options.commandColumnWidth);
      if (input.status === "failed") {
        const message = firstLine(String(input.message ?? ""));
        if (message) write(stdout, `    ${color.red(message)}\n`);
      }
      if (activeStepId === input.stepId) {
        activeStepId = input.parentStepId ?? "";
        if (activeStepId && input.status !== "failed") {
          startSpinner(stdout, spinner, color, numberedStepLabel(activeStepId, stepNumberById, stepLabelById));
        }
      }
    },
    start(input) {
      startInput = input;
      commandsByStep.clear();
      childCountByStep.clear();
      parentByStep.clear();
      stepNumberById.clear();
      stepLabelById.clear();
      activeStepId = "";
      const title = options.title ?? input.cli.title ?? input.cli.app.title;
      write(input.stdout, `${color.bold(title)}\n\n`);
      write(input.stdout, `${color.dim(">")} ${color.cyan(input.workflowId)}${input.argv.length ? ` ${color.dim(input.argv.join(" "))}` : ""}\n\n`);
    },
    startCommand(input) {
      const stdout = startInput?.stdout;
      if (!stdout) return;
      startSpinner(stdout, spinner, color, commandSpinnerLabel(input, activeStepId));
    },
    startStep(input) {
      if (input.parentStepId) parentByStep.set(input.stepId, input.parentStepId);
      stepLabelById.set(input.stepId, input.label ?? input.stepId);
      assignStepNumber(input.stepId, input.parentStepId, stepNumberById, childCountByStep);
      activeStepId = input.stepId || "workflow";
      const stdout = startInput?.stdout;
      if (!stdout) return;
      startSpinner(stdout, spinner, color, numberedStepLabel(activeStepId, stepNumberById, stepLabelById));
    },
  };
}

function startSpinner(
  stdout: WorkflowAppCliWritable,
  spinner: ActiveSpinner,
  color: Color,
  label: string,
  preview?: string,
): void {
  if (!supportsLiveSpinner(stdout)) return;
  if (spinner.label === label && spinner.timer) {
    if (spinner.preview === preview) return;
    spinner.preview = preview;
    writeSpinnerFrame(stdout, spinner, color);
    return;
  }
  stopSpinner(stdout, spinner);
  spinner.frame = 0;
  spinner.label = label;
  spinner.preview = preview;
  writeSpinnerFrame(stdout, spinner, color);
  spinner.timer = setInterval(() => {
    spinner.frame += 1;
    writeSpinnerFrame(stdout, spinner, color);
  }, 80);
  if (typeof spinner.timer === "object" && "unref" in spinner.timer) spinner.timer.unref();
}

function writeSpinnerFrame(
  stdout: WorkflowAppCliWritable,
  spinner: ActiveSpinner,
  color: Color,
): void {
  clearSpinnerFrame(stdout, spinner);
  const frame = spinnerFrames[spinner.frame % spinnerFrames.length] ?? spinnerFrames[0];
  const width = stdout.columns ?? fallbackColumns;
  const labelWidth = Math.max(24, width - 8);
  write(stdout, `  ${color.cyan(frame)} ${color.white(truncate(spinner.label, labelWidth))}`);
  spinner.rendered = true;
  spinner.renderedLines = 1;
  if (spinner.preview) {
    const previewWidth = Math.max(1, width - 6);
    write(stdout, `\n      ${color.dim(truncate(spinner.preview, previewWidth))}`);
    spinner.renderedLines = 2;
  }
}

function stopSpinner(
  stdout: WorkflowAppCliWritable,
  spinner: ActiveSpinner,
): void {
  if (spinner.timer) {
    clearInterval(spinner.timer);
    spinner.timer = undefined;
  }
  clearSpinnerFrame(stdout, spinner);
  spinner.label = "";
  spinner.preview = undefined;
  spinner.rendered = false;
  spinner.renderedLines = 0;
}

function clearSpinnerFrame(
  stdout: WorkflowAppCliWritable,
  spinner: ActiveSpinner,
): void {
  if (!spinner.rendered) return;
  if (spinner.renderedLines === 2) {
    write(stdout, "\r\u001B[2K\u001B[1A\r\u001B[2K");
  } else {
    write(stdout, "\r\u001B[2K");
  }
  spinner.rendered = false;
  spinner.renderedLines = 0;
}

function commandSpinnerLabel(input: WorkflowCliRendererCommandStart, fallbackStepId: string): string {
  const stepId = input.stepId ?? fallbackStepId;
  if (stepId && input.command) return `${stepId}: ${input.command}`;
  return input.command || stepId || "workflow";
}

function stepLine(input: {
  color: Color;
  depth: number;
  durationMs: unknown;
  label?: string;
  number?: string;
  showTimings: boolean;
  status: WorkflowCliStepStatus;
  stepId: string | undefined;
}): string {
  const stepLabel = input.label ?? input.stepId ?? "workflow";
  const label = input.number ? `${input.number}. ${stepLabel}` : stepLabel;
  const timing = input.showTimings && typeof input.durationMs === "number" ? formatMs(input.durationMs) : "";
  const right = input.status === "waiting" ? "waiting" : timing;
  const prefix = input.depth > 0 ? "    \u21b3 " : "  ";
  const labelColumn = label.length >= 42 ? `${label} ` : label.padEnd(42, " ");
  return `${prefix}${stepSymbol(input.status, input.color)} ${input.color.white(labelColumn)}${input.color.dim(right)}\n`;
}

function assignStepNumber(
  stepId: string,
  parentStepId: string | undefined,
  stepNumberById: Map<string, string>,
  childCountByStep: Map<string, number>,
) {
  if (stepNumberById.has(stepId)) return;
  if (!parentStepId) {
    const topLevelCount = [...stepNumberById.values()].filter((value) => !value.includes(".")).length;
    stepNumberById.set(stepId, String(topLevelCount + 1));
    return;
  }
  const childCount = (childCountByStep.get(parentStepId) ?? 0) + 1;
  childCountByStep.set(parentStepId, childCount);
  const parentNumber = stepNumberById.get(parentStepId);
  stepNumberById.set(stepId, parentNumber ? `${parentNumber}.${childCount}` : String(childCount));
}

function numberedStepLabel(
  stepId: string,
  stepNumberById: Map<string, string>,
  stepLabelById: Map<string, string>,
) {
  const number = stepNumberById.get(stepId);
  const label = stepLabelById.get(stepId) ?? stepId;
  return number ? `${number}. ${label}` : label;
}

function writeActivity(
  stdout: WorkflowAppCliWritable,
  input: WorkflowCliActivity,
  color: Color,
  depth: number,
) {
  const prefix = depth > 0 ? "      " : "    ";
  const symbol = activitySymbol(input.status, color);
  write(stdout, `${prefix}\u21b3 ${symbol} ${color.dim(input.phase)} ${color.white(input.text)}\n`);
  for (const child of input.children ?? []) {
    write(stdout, `${prefix}    ${color.dim(`\u00b7 ${child}`)}\n`);
  }
}

function activityDepth(stepId: string | undefined, parentByStep: Map<string, string>) {
  return stepId && parentByStep.has(stepId) ? 1 : 0;
}

function activitySymbol(status: WorkflowCliActivity["status"], color: Color) {
  if (status === "ok") return color.green(check);
  if (status === "error") return color.red(cross);
  if (status === "warning") return color.yellow("!");
  return color.cyan("\u2022");
}

function writeCommandDetails(
  stdout: WorkflowAppCliWritable,
  commands: readonly WorkflowCliCommandDetail[] | undefined,
  showCommands: WorkflowCliRendererOptions["showCommands"],
  color: Color,
  commandColumnWidth: number | undefined,
): void {
  if (!showCommands || !commands?.length) return;
  for (const command of commands) {
    write(stdout, commandLine({
      color,
      command: command.command,
      status: command.status === "skipped" ? undefined : command.status,
      statusKind: command.status,
      targetCommandWidth: commandColumnWidth,
      width: stdout.columns ?? fallbackColumns,
    }));
    if (command.status === "failed" && command.output) {
      write(stdout, failureOutputBlock(command.output, color));
    }
  }
}

function commandLine(input: {
  color: Color;
  command: string;
  status: string | undefined;
  statusKind: WorkflowCliCommandStatus;
  targetCommandWidth: number | undefined;
  width: number;
}): string {
  const prefix = "    - ";
  const separator = " ";
  const minCommandWidth = 24;
  const maxCommandWidth = input.targetCommandWidth ?? 48;
  const statusWidth = input.status ? separator.length + input.status.length : 0;
  const available = input.width - prefix.length - statusWidth;
  const commandWidth = Math.max(minCommandWidth, Math.min(maxCommandWidth, available));
  const command = truncate(input.command, commandWidth);
  if (!input.status) {
    return `    ${input.color.yellow("-")} ${input.color.dim(command)}\n`;
  }
  return `    ${input.color.dim("-")} ${input.color.dim(command.padEnd(commandWidth, " "))}${separator}${commandStatus(input.status, input.statusKind, input.color)}\n`;
}

function stepSymbol(status: WorkflowCliStepStatus, color: Color): string {
  if (status === "completed") return color.green(check);
  if (status === "failed") return color.red(cross);
  if (status === "skipped") return color.yellow(check);
  if (status === "waiting") return color.yellow("?");
  return check;
}

function commandStatus(label: string, status: WorkflowCliCommandStatus, color: Color): string {
  if (status === "completed") return color.green(label);
  if (status === "failed") return color.red(label);
  return color.yellow(label);
}

function failureOutputBlock(output: string, color: Color): string {
  const lines = output.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const tail = lines.slice(-8);
  return tail.map((line) => `      ${color.dim(truncate(line, 120))}\n`).join("");
}

function artifactSummary(artifacts: readonly WorkflowAppArtifact[]): string {
  if (artifacts.length === 0) return "none";
  return artifacts.map((artifact) => artifact.name).join(", ");
}

function formatMs(value: number): string {
  return `${Math.max(0, Math.round(value))}ms`;
}

function firstLine(value: string): string {
  const line = value.split(/\r?\n/, 1)[0]?.trim();
  return line || value;
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

function write(output: WorkflowAppCliWritable, value: string): void {
  output.write(value);
}

function supportsLiveSpinner(output: WorkflowAppCliWritable): boolean {
  if (output.isTTY === false) return false;
  return output.isTTY === true || typeof output.columns === "number";
}

type Color = ReturnType<typeof createColor>;

function createColor(enabled: boolean): {
  bold(value: string): string;
  cyan(value: string): string;
  dim(value: string): string;
  green(value: string): string;
  red(value: string): string;
  white(value: string): string;
  yellow(value: string): string;
} {
  const wrap = (open: number, close: number) => (value: string) => enabled ? `\u001B[${open}m${value}\u001B[${close}m` : value;
  return {
    bold: wrap(1, 22),
    cyan: wrap(36, 39),
    dim: wrap(2, 22),
    green: wrap(32, 39),
    red: wrap(31, 39),
    white: wrap(37, 39),
    yellow: wrap(33, 39),
  };
}

function autoColor(): boolean {
  return process.env.NO_COLOR === undefined;
}

function resolveColor(input: WorkflowCliRendererOptions["color"]): boolean {
  if (typeof input === "boolean") return input;
  if (input === "auto") return autoColor();
  return true;
}
