import type {
  EventRecord,
  LoopGraphProjection,
  Question,
} from "../../core/index.js";
import type {
  TraceStream,
} from "./trace-stream.js";
import {
  projectWorkflowRun,
  type WorkflowRunProjection,
  type WorkflowRunStepStatus,
} from "./workflow-run-projection.js";

export type TerminalWorkflowOutput = {
  columns?: number;
  isTTY?: boolean;
  write(chunk: string): unknown;
};

export type TerminalWorkflowRenderer = {
  close(): void;
  pause(): void;
  render(): void;
  resume(): void;
  snapshot(): WorkflowRunProjection;
};

export function createTerminalWorkflowRenderer(input: {
  color?: boolean;
  graph: LoopGraphProjection;
  input?: unknown;
  output: TerminalWorkflowOutput;
  stream: TraceStream;
}): TerminalWorkflowRenderer {
  const output = input.output;
  const color = createColor(Boolean(input.color));
  const events: EventRecord[] = [];
  let paused = false;
  let closed = false;
  let projection = projectWorkflowRun({
    events,
    graph: input.graph,
    input: input.input,
  });

  const redraw = () => {
    if (closed || paused) return;
    projection = projectWorkflowRun({
      events,
      graph: input.graph,
      input: input.input,
    });
    if (output.isTTY) output.write("\u001b[2J\u001b[H");
    output.write(renderTerminalWorkflowFrame(projection, {
      color,
      columns: output.columns,
    }));
  };

  const unsubscribe = input.stream.subscribe((update) => {
    events.push(update.event);
    redraw();
  });

  redraw();

  return {
    close() {
      closed = true;
      unsubscribe();
      if (output.isTTY) output.write("\u001b[?25h");
    },
    pause() {
      paused = true;
      if (output.isTTY) output.write("\n");
    },
    render() {
      redraw();
    },
    resume() {
      paused = false;
      redraw();
    },
    snapshot() {
      return projection;
    },
  };
}

export function renderTerminalWorkflowFrame(
  projection: WorkflowRunProjection,
  options: {
    color?: ReturnType<typeof createColor>;
    columns?: number;
  } = {},
) {
  const color = options.color ?? createColor(false);
  const width = Math.max(72, Math.min(options.columns ?? 100, 120));
  const inner = width - 4;
  const lines: string[] = [];
  const headerParts = [
    projection.graph.id,
    projection.runId,
    projection.status,
  ].filter(Boolean);
  lines.push(topBorder(headerParts.join(" - "), width));
  const inputText = inputLabel(projection.input);
  if (inputText) lines.push(row(`Prompt: ${inputText}`, width));
  lines.push(section("Workflow", width));
  for (const step of projection.steps) {
    const status = stepStatusLabel(step.status, color);
    const score = typeof step.score === "number" ? `${Math.round(step.score * 100)}%` : "--";
    const note = step.note ?? "";
    lines.push(row([
      formatStepIndex(step, color),
      truncate(step.label, 24).padEnd(24),
      status.padEnd(12 + colorPad(status)),
      score.padEnd(6),
      truncate(note, inner - 2 - 3 - 24 - 12 - 6),
    ].join(" "), width));
  }
  lines.push(bottomBorder(width));
  lines.push("");

  const current = projection.currentStep;
  lines.push(`Current step: ${current ? `${formatStepIndex(current, color)} ${current.label}` : "(none)"}`);
  lines.push(`Status: ${projection.status}`);
  const latestLoop = projection.loops.at(-1);
  if (latestLoop) {
    lines.push(`Loop: ${latestLoop.fromStepId} -> ${latestLoop.targetStepId}`);
    if (latestLoop.reason) lines.push(`Reason: ${latestLoop.reason}`);
  }

  if (projection.activity.length > 0) {
    lines.push("");
    lines.push("Activity:");
    for (const item of projection.activity) {
      lines.push(`  ${activityGlyph(item.status, color)} ${truncate(item.message, width - 6)}`);
    }
  }

  if (projection.pendingQuestions.length > 0) {
    lines.push("");
    lines.push(renderQuestionPreview(projection.pendingQuestions[0]!, width));
  }

  return `${lines.join("\n")}\n`;
}

function renderQuestionPreview(question: Question, width: number) {
  const lines = [
    question.title ?? "Question",
    truncate(question.prompt, width),
  ];
  if (question.options && question.options.length > 0) {
    lines.push("");
    for (const [index, option] of question.options.entries()) {
      lines.push(`  ${index + 1}. ${option.label}`);
    }
  }
  lines.push("");
  lines.push("Answer below. Press Enter to assume when available.");
  lines.push("> ");
  return lines.join("\n");
}

function topBorder(title: string, width: number) {
  const safeTitle = ` ${truncate(title, width - 6)} `;
  return `┌${safeTitle}${"─".repeat(Math.max(0, width - safeTitle.length - 2))}┐`;
}

function section(title: string, width: number) {
  const safeTitle = ` ${title} `;
  return `├${safeTitle}${"─".repeat(Math.max(0, width - safeTitle.length - 2))}┤`;
}

function bottomBorder(width: number) {
  return `└${"─".repeat(width - 2)}┘`;
}

function row(value: string, width: number) {
  const plain = stripAnsi(value);
  const visibleWidth = width - 4;
  const content = plain.length > visibleWidth
    ? truncateAnsi(value, visibleWidth)
    : `${value}${" ".repeat(visibleWidth - plain.length)}`;
  return `│ ${content} │`;
}

function stepStatusLabel(status: WorkflowRunStepStatus, color: ReturnType<typeof createColor>) {
  if (status === "done") return color.green("✓ done");
  if (status === "failed") return color.red("× failed");
  if (status === "looped") return color.red("↺ looped");
  if (status === "retrying") return color.yellow("↻ retry");
  if (status === "revisiting") return color.yellow("◐ revisit");
  if (status === "running") return color.cyan("◐ running");
  if (status === "stale") return color.yellow("↺ stale");
  if (status === "waiting") return color.yellow("? waiting");
  return color.dim("· pending");
}

function activityGlyph(status: string, color: ReturnType<typeof createColor>) {
  if (status === "ok") return color.green("✓");
  if (status === "error") return color.red("×");
  if (status === "waiting") return color.yellow("?");
  if (status === "running") return color.cyan("◐");
  return color.dim("·");
}

function inputLabel(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "prompt" in value && typeof value.prompt === "string") {
    return value.prompt;
  }
  if (value === undefined) return undefined;
  return JSON.stringify(value);
}

function formatStepIndex(step: { boundary?: "end" | "trigger"; index: number }, color?: ReturnType<typeof createColor>) {
  if (step.boundary === "trigger") return color ? color.green("[start]") : "[start]";
  if (step.boundary === "end") return color ? color.yellow("[end]") : "[end]";
  return String(step.index).padStart(2, "0");
}

function truncate(value: string, maxLength: number) {
  if (maxLength <= 0) return "";
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function truncateAnsi(value: string, maxLength: number) {
  return truncate(stripAnsi(value), maxLength);
}

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function colorPad(value: string) {
  return value.length - stripAnsi(value).length;
}

function createColor(enabled: boolean) {
  const wrap = (code: number, value: string) => enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
  return {
    cyan: (value: string) => wrap(36, value),
    dim: (value: string) => wrap(2, value),
    green: (value: string) => wrap(32, value),
    red: (value: string) => wrap(31, value),
    yellow: (value: string) => wrap(33, value),
  };
}
