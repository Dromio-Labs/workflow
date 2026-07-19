export type TerminalTraceChild = string | {
  children?: TerminalTraceChild[];
  text: string;
};

export type TerminalTraceItem = {
  children?: TerminalTraceChild[];
  id: string;
  phaseId: string;
  phaseTitle: string;
  status: "error" | "info" | "ok" | "running" | "warning";
  text: string;
};

export type TerminalTraceRenderer = {
  close(): void;
};

export type TerminalTraceOutput = {
  isTTY?: boolean;
  write(chunk: string): unknown;
};
