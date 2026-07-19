import type {
  EventRecord,
} from "../../core/index.js";
import {
  defaultFormatEvent,
} from "./terminal-trace-format.js";
import type {
  TraceStream,
} from "./trace-stream.js";
import type {
  TraceTreeSnapshot,
} from "./trace-tree.js";
import type {
  TerminalTraceChild,
  TerminalTraceItem,
  TerminalTraceOutput,
  TerminalTraceRenderer,
} from "./terminal-trace-types.js";

export {
  defaultFormatEvent,
} from "./terminal-trace-format.js";

export type {
  TerminalTraceChild,
  TerminalTraceItem,
  TerminalTraceOutput,
  TerminalTraceRenderer,
} from "./terminal-trace-types.js";

export function createTerminalTraceRenderer(input: {
  color?: boolean;
  formatEvent?: (event: EventRecord, snapshot: TraceTreeSnapshot) => TerminalTraceItem | undefined;
  frames?: string[];
  intervalMs?: number;
  output: TerminalTraceOutput;
  spinner?: boolean;
  stream: TraceStream;
}): TerminalTraceRenderer {
  const color = createColor(Boolean(input.color));
  const openedPhases = new Set<string>();
  let activePhaseId: string | undefined;
  const spinner = {
    frame: 0,
    item: undefined as TerminalTraceItem | undefined,
    timer: undefined as ReturnType<typeof setInterval> | undefined,
  };
  const frames = input.frames ?? ["-", "\\", "|", "/"];
  const spinnerEnabled = input.spinner !== false && Boolean(input.output.isTTY);
  const unsubscribe = input.stream.subscribe((update) => {
    const item = input.formatEvent?.(update.event, update.snapshot) ?? defaultFormatEvent(update.event);
    if (!item) return;
    activePhaseId = ensurePhase(input.output, openedPhases, activePhaseId, item, color);
    if (item.status === "running" && spinnerEnabled) {
      startSpinner(input.output, spinner, item, frames, input.intervalMs ?? 80, color);
      return;
    }
    if (spinner.item) {
      stopSpinner(input.output, spinner);
    }
    printItem(input.output, item, color);
  });
  return {
    close() {
      unsubscribe();
      stopSpinner(input.output, spinner);
    },
  };
}

function ensurePhase(
  output: TerminalTraceOutput,
  openedPhases: Set<string>,
  activePhaseId: string | undefined,
  item: TerminalTraceItem,
  color: ReturnType<typeof createColor>,
) {
  if (openedPhases.has(item.phaseId) && activePhaseId === item.phaseId) {
    return activePhaseId;
  }
  openedPhases.add(item.phaseId);
  output.write(`\n${color.bold(item.phaseTitle)}\n`);
  return item.phaseId;
}

function printItem(
  output: TerminalTraceOutput,
  item: TerminalTraceItem,
  color: ReturnType<typeof createColor>,
) {
  output.write(`  ${color.dim("+--")} ${statusLabel(item.status, color)} ${item.text}\n`);
  if (item.children?.length) {
    printChildren(output, item.children, color, "  |   ");
  }
}

function printChildren(
  output: TerminalTraceOutput,
  children: TerminalTraceChild[],
  color: ReturnType<typeof createColor>,
  prefix: string,
) {
  for (const child of children) {
    const text = typeof child === "string" ? child : child.text;
    output.write(`${color.dim(`${prefix}+--`)} ${text}\n`);
    if (typeof child !== "string" && child.children?.length) {
      printChildren(output, child.children, color, `${prefix}|   `);
    }
  }
}

function startSpinner(
  output: TerminalTraceOutput,
  spinner: {
    frame: number;
    item?: TerminalTraceItem;
    timer?: ReturnType<typeof setInterval>;
  },
  item: TerminalTraceItem,
  frames: string[],
  intervalMs: number,
  color: ReturnType<typeof createColor>,
) {
  stopSpinner(output, spinner);
  spinner.item = item;
  spinner.frame = 0;
  writeSpinnerFrame(output, spinner, frames, color);
  spinner.timer = setInterval(() => {
    spinner.frame += 1;
    writeSpinnerFrame(output, spinner, frames, color);
  }, intervalMs);
}

function writeSpinnerFrame(
  output: TerminalTraceOutput,
  spinner: {
    frame: number;
    item?: TerminalTraceItem;
  },
  frames: string[],
  color: ReturnType<typeof createColor>,
) {
  if (!spinner.item) return;
  const frame = frames[spinner.frame % frames.length] ?? "-";
  output.write(`\r\u001b[2K  ${color.dim("+--")} ${color.cyan(frame)} ${spinner.item.text}`);
}

function stopSpinner(
  output: TerminalTraceOutput,
  spinner: {
    frame: number;
    item?: TerminalTraceItem;
    timer?: ReturnType<typeof setInterval>;
  },
) {
  if (spinner.timer) {
    clearInterval(spinner.timer);
    spinner.timer = undefined;
  }
  if (spinner.item) {
    output.write("\r\u001b[2K");
    spinner.item = undefined;
  }
}

function statusLabel(status: TerminalTraceItem["status"], color: ReturnType<typeof createColor>) {
  if (status === "ok") return color.green("ok");
  if (status === "error") return color.red("fail");
  if (status === "warning") return color.yellow("warn");
  if (status === "running") return color.cyan("run");
  return color.cyan("info");
}

function createColor(enabled: boolean) {
  const wrap = (code: number, value: string) => enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
  return {
    bold: (value: string) => wrap(1, value),
    cyan: (value: string) => wrap(36, value),
    dim: (value: string) => wrap(2, value),
    green: (value: string) => wrap(32, value),
    red: (value: string) => wrap(31, value),
    yellow: (value: string) => wrap(33, value),
  };
}
