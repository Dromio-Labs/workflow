import { describe, expect, test } from "bun:test";

import {
  createWorkflowCliRenderer,
} from "./terminal-renderer.js";
import type {
  WorkflowAppCliReporterDefinition,
  WorkflowAppCliWritable,
} from "./types.js";

describe("createWorkflowCliRenderer", () => {
  test("renders a dim transient activity preview and clears it on completion", () => {
    const stdout = memoryWritable({ columns: 220, isTTY: true });
    const renderer = createWorkflowCliRenderer({ color: true });

    renderer.start({
      argv: ["hello"],
      cli: fakeCli(),
      input: {},
      stderr: memoryWritable(),
      stdout,
      workflowId: "dromio.publish",
    });
    renderer.activity({
      children: ["Streaming model output"],
      phase: "Model",
      status: "running",
      stepId: "generate-response",
      text: "Generate response (test-provider/test-model)",
    });
    renderer.activity({
      children: ["22 chars"],
      phase: "Model",
      status: "ok",
      stepId: "generate-response",
      text: "Generate response (test-provider/test-model)",
    });

    const output = stdout.read();
    expect(output).toContain("\u001B[2mStreaming model output\u001B[22m");
    expect(output).toContain("\r\u001B[2K\u001B[1A\r\u001B[2K");
    expect(output.slice(output.lastIndexOf("\u001B[1A"))).not.toContain("Streaming model output");
    expect(output).toContain("22 chars");
  });

  test("renders workflow task progress without the reporter adapter", () => {
    const stdout = memoryWritable({ columns: 80, isTTY: false });
    const stderr = memoryWritable({ columns: 80, isTTY: false });
    const renderer = createWorkflowCliRenderer({
      color: false,
      showTimings: true,
      title: "Renderer Test",
    });

    renderer.start({
      argv: ["patch", "--dry-run"],
      cli: fakeCli(),
      input: {},
      stderr,
      stdout,
      workflowId: "dromio.publish",
    });
    renderer.startStep({ stepId: "install-dependencies" });
    renderer.startCommand({ command: "bun install", stepId: "install-dependencies" });
    renderer.finishCommand({
      command: "bun install",
      status: "skipped",
      stepId: "install-dependencies",
    });
    renderer.finishStep({
      durationMs: 12,
      status: "skipped",
      stepId: "install-dependencies",
    });
    renderer.startStep({ parentStepId: "publish", stepId: "publish.verify" });
    renderer.activity({
      children: ["policy: score.release"],
      phase: "Evaluation",
      status: "ok",
      stepId: "publish.verify",
      text: "Release quality: 92% pass",
    });
    renderer.finishStep({
      durationMs: 8,
      parentStepId: "publish",
      status: "completed",
      stepId: "publish.verify",
    });
    renderer.startStep({
      label: "generated-response.assess-response",
      parentStepId: "review-response",
      stepId: "review-response.generated-response.assess-response",
    });
    renderer.finishStep({
      durationMs: 9,
      label: "generated-response.assess-response",
      parentStepId: "review-response",
      status: "completed",
      stepId: "review-response.generated-response.assess-response",
    });

    const output = stdout.read();
    expect(output).toContain("Renderer Test");
    expect(output).toContain("> dromio.publish patch --dry-run");
    expect(output).toContain("\u2713 1. install-dependencies");
    expect(output).toContain("- bun install");
    expect(output).not.toContain("skipped dry-run");
    expect(output).toContain("Evaluation");
    expect(output).toContain("Release quality: 92% pass");
    expect(output).toContain("\u21b3 \u2713 1. publish.verify");
    expect(output).toMatch(/\u21b3 \u2713 1\. generated-response\.assess-response\s+9ms/);
    expect(output).not.toContain("review-response.generated-response.assess-response");
  });
});

function fakeCli(): WorkflowAppCliReporterDefinition {
  return {
    app: { title: "Dromio Release" } as WorkflowAppCliReporterDefinition["app"],
    title: "Dromio Release",
    workflowId: "dromio.publish",
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
