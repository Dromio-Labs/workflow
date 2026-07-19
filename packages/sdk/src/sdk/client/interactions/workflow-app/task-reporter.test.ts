import { describe, expect, test } from "bun:test";

import type {
  EventRecord,
} from "../../../core/index.js";
import {
  createWorkflowTaskReporter,
} from "./task-reporter.js";
import type {
  WorkflowAppCliReporterDefinition,
  WorkflowAppCliWritable,
  WorkflowCliActivity,
  WorkflowCliRenderer,
} from "./types.js";

describe("createWorkflowTaskReporter", () => {
  test("renders a live spinner for TTY outputs", async () => {
    const stdout = memoryWritable({ columns: 80, isTTY: true });
    const stderr = memoryWritable({ columns: 80, isTTY: true });
    const reporter = createWorkflowTaskReporter({ color: false, showTimings: false });

    reporter.onStart?.({
      argv: ["patch"],
      cli: fakeCli(),
      input: {},
      stderr,
      stdout,
      workflowId: "dromio.publish",
    });
    reporter.onEvent?.(event({ stepId: "run-live-mcp-eval", type: "step.started" }));
    await sleep(90);
    reporter.onEvent?.(event({
      durationMs: 100,
      stepId: "run-live-mcp-eval",
      type: "step.completed",
    }));

    const output = stdout.read();
    expect(output).toContain("\r\u001B[2K");
    expect(output).toContain("run-live-mcp-eval");
    expect(output).toContain("\u280b");
    expect(output).toContain("\u2819");
    expect(output).toContain("\u2713 1. run-live-mcp-eval");
  });

  test("keeps non-TTY output stable", () => {
    const stdout = memoryWritable({ columns: 80, isTTY: false });
    const stderr = memoryWritable({ columns: 80, isTTY: false });
    const reporter = createWorkflowTaskReporter({ color: false, showTimings: false });

    reporter.onStart?.({
      argv: ["patch"],
      cli: fakeCli(),
      input: {},
      stderr,
      stdout,
      workflowId: "dromio.publish",
    });
    reporter.onEvent?.(event({ stepId: "run-checks", type: "step.started" }));
    reporter.onEvent?.(event({
      durationMs: 1,
      stepId: "run-checks",
      type: "step.completed",
    }));

    const output = stdout.read();
    expect(output).not.toContain("\r\u001B[2K");
    expect(output).not.toContain("\u280b");
    expect(output).toContain("\u2713 1. run-checks");
  });

  test("prints captured failed command output", () => {
    const stdout = memoryWritable({ columns: 80, isTTY: false });
    const stderr = memoryWritable({ columns: 80, isTTY: false });
    const reporter = createWorkflowTaskReporter({ color: false, showTimings: false });

    reporter.onStart?.({
      argv: ["patch"],
      cli: fakeCli(),
      input: {},
      stderr,
      stdout,
      workflowId: "dromio.publish",
    });
    reporter.onEvent?.(event({
      command: "make check",
      stderr: "src/components/offering-snippets.ts(39,31): error TS1354",
      stdout: "$ tsc --noEmit",
      stepId: "run-checks",
      type: "command.failed",
    }));
    reporter.onEvent?.(event({
      durationMs: 1,
      message: "Command failed: make check",
      stepId: "run-checks",
      type: "step.failed",
    }));

    const output = stdout.read();
    expect(output).toContain("make check");
    expect(output).toContain("$ tsc --noEmit");
    expect(output).toContain("offering-snippets.ts(39,31): error TS1354");
  });

  test("accumulates a safe 150-character model preview by span", () => {
    const activities: WorkflowCliActivity[] = [];
    const reporter = createWorkflowTaskReporter({
      renderer: captureRenderer(activities),
    });

    reporter.onStart?.({
      argv: ["hello"],
      cli: fakeCli(),
      input: {},
      stderr: memoryWritable(),
      stdout: memoryWritable(),
      workflowId: "demo.generate",
    });
    reporter.onEvent?.(modelEvent("model.request.started", {
      detail: {
        model: "test-model",
        operation: "Generate response",
        provider: "test-provider",
      },
    }));
    reporter.onEvent?.(modelEvent("model.response.delta", {
      detail: { delta: "Hello\n" },
    }));
    reporter.onEvent?.(modelEvent("model.response.delta", {
      detail: { delta: `world \u001B[31m${"x".repeat(200)}` },
    }));
    reporter.onEvent?.(modelEvent("model.response.completed", {
      detail: { contentLength: 212 },
    }));

    expect(activities.map((activity) => activity.status)).toEqual([
      "running",
      "running",
      "running",
      "ok",
    ]);
    expect(activities[1]?.children).toEqual(["Hello "]);
    const preview = activities[2]?.children?.[0] ?? "";
    expect(preview).toHaveLength(151);
    expect(preview).toEndWith("…");
    expect(preview).not.toContain("\u001B");
    expect(activities[3]?.children).toEqual(["212 chars"]);
  });
});

function modelEvent(type: string, input: Partial<EventRecord>): EventRecord {
  return {
    correlationId: "correlation-demo",
    index: 1,
    message: type,
    runId: "run-demo",
    stepId: "generate-response",
    timestamp: "2026-01-01T00:00:00.000Z",
    trace: {
      attributes: {
        model: "test-model",
        operation: "Generate response",
        provider: "test-provider",
      },
      name: "Generate response",
      spanId: "model:generate-response",
      traceId: "run-demo",
    },
    type,
    ...input,
  };
}

function captureRenderer(activities: WorkflowCliActivity[]): WorkflowCliRenderer {
  return {
    activity(input) {
      activities.push(input);
    },
    complete() {},
    dispose() {},
    error() {},
    finishCommand() {},
    finishStep() {},
    start() {},
    startCommand() {},
    startStep() {},
  };
}

function fakeCli(): WorkflowAppCliReporterDefinition {
  return {
    app: { title: "Dromio Release" } as WorkflowAppCliReporterDefinition["app"],
    title: "Dromio Release",
    workflowId: "dromio.publish",
  };
}

function event(input: Partial<EventRecord> & Pick<EventRecord, "type">): EventRecord {
  return {
    correlationId: "test",
    index: 0,
    message: input.type,
    runId: "run",
    timestamp: new Date(0).toISOString(),
    ...input,
  };
}

function memoryWritable(input: {
  columns?: number;
  isTTY?: boolean;
} = {}): WorkflowAppCliWritable & { read(): string } {
  let value = "";
  return {
    columns: input.columns,
    isTTY: input.isTTY,
    read() {
      return value;
    },
    write(chunk) {
      value += chunk;
      return true;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
