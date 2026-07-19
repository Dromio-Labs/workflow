import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";

import {
  ask,
  commandEvent,
  done,
  fail,
  loop,
  createRuntimeStep,
} from "@dromio/workflow/core";
import {
  createWorkflowApp,
  createWorkflowTaskReporter,
  defineWorkflowAppCli,
  runWorkflowAppCli,
  runWorkflowAppCliResult,
  type WorkflowAppCliDefinition,
  type WorkflowAppCliWritable,
} from "@dromio/workflow/client";

describe("workflow app CLI runner", () => {
  test("runs a workflow app with standardized task output", async () => {
    const stdout = memoryWritable();
    const stderr = memoryWritable();
    const result = await runWorkflowAppCliResult(demoCli(), {
      argv: ["patch"],
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    expect(result.exitCode).toBe(0);
    const output = stripAnsi(stdout.read());
    expect(output).toContain("Demo CLI");
    expect(output).toContain("> demo.publish patch");
    expect(output).toContain("1. prepare");
    expect(output).toContain("Model");
    expect(output).toContain("Draft output (test-provider/test-model)");
    expect(output).toContain("12 chars");
    expect(output).toContain("Gate");
    expect(output).toContain("score 90% [pass]");
    expect(output).toContain("Evaluation");
    expect(output).toContain("Draft quality: 90% pass");
    expect(output).toContain("Fork Forking 2 branches concurrently.");
    expect(output).toContain("Branch Completed assessment branch.");
    expect(output).toContain("Join Joined 2 branch results.");
    expect(output).toContain("bun run build");
    expect(output).not.toContain("skipped dry-run");
    expect(output).toContain("2. publish");
    expect(output).toContain("Completed demo.publish");
    expect(output).toContain("demo-result");
    expect(stderr.read()).toBe("");
  });

  test("colors task output by default", async () => {
    const stdout = memoryWritable();
    const stderr = memoryWritable();
    const result = await runWorkflowAppCliResult(demoCli(), {
      argv: ["patch"],
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    expect(result.exitCode).toBe(0);
    expect(stdout.read()).toContain("\u001B[");
    const output = stripAnsi(stdout.read());
    expect(output).toContain("bun run build");
    expect(output).not.toContain("skipped dry-run");
  });

  test("uses color and truncation instead of status text for skipped commands", async () => {
    const stdout = memoryWritable({ columns: 72 });
    const stderr = memoryWritable();
    const result = await runWorkflowAppCliResult(demoCli({
      command: "make e2e-external-consumer-product-mcp-live-agent-eval",
    }), {
      argv: ["patch"],
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    expect(result.exitCode).toBe(0);
    const rawCommandLine = stdout.read()
      .split("\n")
      .find((line) => line.includes("make e2e-external-consumer"));
    expect(rawCommandLine).toContain("\u001B[33m");
    expect(rawCommandLine).not.toContain("\u001B[33mmake");
    const commandLine = stripAnsi(rawCommandLine ?? "");
    expect(commandLine).toContain("...");
    expect(commandLine).not.toContain("skipped dry-run");
    expect(commandLine.length).toBeLessThanOrEqual(58);
  });

  test("returns parser failures with usage without exiting", async () => {
    const stdout = memoryWritable();
    const stderr = memoryWritable();
    const result = await runWorkflowAppCliResult(demoCli({
      parseArgs() {
        throw new Error("Choose patch, minor, or major.");
      },
    }), {
      argv: ["banana"],
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    expect(result.exitCode).toBe(1);
    expect(result.error?.message).toBe("Choose patch, minor, or major.");
    expect(stdout.read()).toBe("");
    const output = stripAnsi(stderr.read());
    expect(output).toContain("Failed demo.publish");
    expect(output).toContain("Choose patch, minor, or major.");
    expect(output).toContain("Usage:");
    expect(output).toContain("demo publish <patch|minor|major>");
  });

  test("allows the default runner to skip process exit for embedded callers", async () => {
    const stdout = memoryWritable();
    const stderr = memoryWritable();
    const result = await runWorkflowAppCli(demoCli(), {
      argv: ["minor"],
      exit: false,
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    expect(result.exitCode).toBe(0);
    expect(stripAnsi(stdout.read())).toContain("> demo.publish minor");
  });

  test("returns failed workflow runs as exit code one", async () => {
    const stdout = memoryWritable();
    const stderr = memoryWritable();
    const result = await runWorkflowAppCliResult(demoCli({ shouldFail: true }), {
      argv: ["patch"],
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    expect(result.exitCode).toBe(1);
    expect(result.run?.status).toBe("failed");
    const output = stripAnsi(stdout.read());
    expect(output).toContain("Failed demo.publish");
    expect(output).toContain("publish failed");
  });

  test("answers interactive questions and resumes the compact workflow", async () => {
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    const output = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    output.isTTY = true;
    let written = "";
    output.on("data", (chunk) => {
      written += chunk.toString();
    });
    queueMicrotask(() => input.write("1\n"));

    const result = await runWorkflowAppCliResult(questionCli(), {
      argv: ["ship"],
      input,
      interactive: true,
      stderr: output,
      stdout: output,
    });

    expect(result.exitCode).toBe(0);
    expect(result.run?.session.answers?.scope).toBe("minimal");
    expect(written).toContain("Which scope should the response use?");
    expect(stripAnsi(written)).toContain("Completed demo.question");
  });
});

type DemoInput = {
  bump: "major" | "minor" | "patch";
};

type DemoCliOptions = {
  command?: string;
  parseArgs?(argv: readonly string[]): DemoInput;
  shouldFail?: boolean;
};

function demoCli(options: DemoCliOptions = {}): WorkflowAppCliDefinition<DemoInput> {
  const workflow = loop<unknown, string>({
    id: "demo.publish",
    steps: [
      createRuntimeStep("prepare", (context) => {
        context.emit({
          detail: {
            contentLength: 12,
            model: "test-model",
            operation: "Draft output",
            provider: "test-provider",
          },
          message: "Draft output completed.",
          stepId: "prepare",
          trace: {
            attributes: { operation: "Draft output", phase: "model" },
            name: "Draft output",
            spanId: "model:draft-output",
            status: "ok",
            traceId: "run-demo",
          },
          type: "model.response.completed",
        });
        context.emit({
          detail: {
            evaluation: {
              score: 0.9,
              scorePolicyId: "score.demo",
              status: "pass",
            },
            operationId: "draft-output",
          },
          message: "Draft output passed its score gate.",
          stepId: "prepare",
          type: "score.gated",
        });
        context.emit({
          detail: {
            evaluation: {
              gaps: [],
              label: "Draft quality",
              questions: [],
              risks: [],
              satisfies: [],
              score: 0.9,
              status: "pass",
              subjectId: "draft-output",
              threshold: 0.8,
            },
          },
          message: "Draft quality passed.",
          stepId: "prepare",
          type: "evaluation.completed",
        });
        context.emit(commandEvent({
          command: options.command ?? "bun run build",
          commandId: "build",
          message: "Skipped build.",
          stepId: "prepare",
          title: "Build",
          type: "command.skipped",
        }));
        context.emit({
          detail: { concurrency: 2 },
          message: "Forking 2 branches concurrently.",
          stepId: "prepare",
          type: "fork.started",
        });
        context.emit({
          detail: { branchId: "assessment" },
          message: "Completed assessment branch.",
          stepId: "prepare",
          type: "fork.branch.completed",
        });
        context.emit({
          detail: { branchIds: ["assessment", "analysis"] },
          message: "Joined 2 branch results.",
          stepId: "prepare",
          type: "join.completed",
        });
        return done({ ok: true });
      }),
      createRuntimeStep("publish", () => options.shouldFail ? fail("publish failed") : done({ ok: true })),
    ],
  });
  const app = createWorkflowApp({
    id: "demo",
    title: "Demo App",
    workflows: {
      "demo.publish": {
        result: {
          format() {
            return "demo-result";
          },
        },
        title: "Demo Publish",
        workflow,
      },
    },
  });
  return defineWorkflowAppCli({
    app,
    encodeInput(input) {
      return JSON.stringify(input);
    },
    parseArgs: options.parseArgs ?? parseDemoArgs,
    reporter: createWorkflowTaskReporter({ title: "Demo CLI" }),
    title: "Demo CLI",
    usage: "demo publish <patch|minor|major>",
    workflowId: "demo.publish",
  });
}

function questionCli(): WorkflowAppCliDefinition<string> {
  const workflow = loop({
    id: "demo.question",
    steps: [
      createRuntimeStep("answer-question", (context) => {
        if ("scope" in context.answers) return done({ scope: context.answers.scope });
        return ask({
          id: "scope",
          options: [
            { label: "Minimal", value: "minimal" },
            { label: "Complete", value: "complete" },
          ],
          prompt: "Which scope should the response use?",
          title: "Response scope",
          type: "choice",
        });
      }),
    ],
  });
  const app = createWorkflowApp({
    workflows: {
      "demo.question": {
        result: { format: (session) => `Scope: ${session.answers?.scope}` },
        workflow,
      },
    },
  });
  return defineWorkflowAppCli({
    app,
    encodeInput: (input) => input,
    parseArgs: (argv) => argv.join(" "),
    workflowId: "demo.question",
  });
}

function parseDemoArgs(argv: readonly string[]): DemoInput {
  const [bump] = argv;
  if (bump !== "major" && bump !== "minor" && bump !== "patch") {
    throw new Error("Choose patch, minor, or major.");
  }
  return { bump };
}

function memoryWritable(input: { columns?: number } = {}): {
  read(): string;
  stream: WorkflowAppCliWritable;
} {
  let value = "";
  return {
    read() {
      return value;
    },
    stream: {
      columns: input.columns,
      write(chunk) {
        value += chunk;
        return true;
      },
    },
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}
