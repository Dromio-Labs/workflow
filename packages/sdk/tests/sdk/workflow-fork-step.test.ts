import { describe, expect, test } from "bun:test";
import { done, loop, createRuntimeStep } from "@dromio/workflow/core";
import {
  createWorkflowForkBranch,
  forkWorkflowStep,
  WorkflowForkError,
} from "../../src/sdk/product/step/workflow-fork-step.js";
import { z } from "zod";

const textSchema = z.string().min(1);

describe("workflow fork product step", () => {
  test("starts named child workflows concurrently and joins typed results", async () => {
    const started: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const child = (id: "first-child" | "second-child", value: string) => loop({
      id,
      steps: [createRuntimeStep("work", async () => {
        started.push(id);
        if (started.length === 2) release();
        await gate;
        return done({ value });
      })],
    });
    const firstWorkflow = { documentId: "first-child", id: "first-child" };
    const secondWorkflow = { documentId: "second-child", id: "second-child" };
    const parent = loop({
      id: "testing.fork-parent",
      steps: [
        forkWorkflowStep({
          id: "fork-review",
          label: "Fork review",
          input: { source: textSchema },
          output: { joined: textSchema },
          branches: ({ input }) => [
            createWorkflowForkBranch({
              id: "assessment",
              label: "Assessment branch",
              workflow: firstWorkflow,
              childInput: { value: input.source },
              createWorkflow: child("first-child", "assessed"),
              mapResult: (session) => textSchema.parse(session.state.value),
            }),
            createWorkflowForkBranch({
              id: "analysis",
              label: "Analysis branch",
              workflow: secondWorkflow,
              childInput: { value: input.source },
              createWorkflow: child("second-child", "analyzed"),
              mapResult: (session) => textSchema.parse(session.state.value),
            }),
          ] as const,
          join: (results) => ({ joined: `${results.assessment}+${results.analysis}` }),
        }),
      ],
    });

    const session = await parent.start({ source: "response" });

    expect(started).toEqual(["first-child", "second-child"]);
    expect(session.state.joined).toBe("assessed+analyzed");
    const events = session.events;
    const branchStarted = events.filter((event) => event.type === "fork.branch.started");
    const branchCompleted = events.filter((event) => event.type === "fork.branch.completed");
    expect(Math.max(...branchStarted.map((event) => event.index)))
      .toBeLessThan(Math.min(...branchCompleted.map((event) => event.index)));
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "fork.started",
      "fork.completed",
      "join.started",
      "join.completed",
    ]));
    expect(events.find((event) => event.stepId === "fork-review.assessment.work")?.trace).toMatchObject({
      parentSpanId: "fork:fork-review:attempt:1:branch:assessment",
      traceId: session.runId,
    });
  });

  test("waits for every started branch to settle before failing the fork", async () => {
    let successfulBranchSettled = false;
    const failed = loop({
      id: "failed-child",
      steps: [createRuntimeStep("fail", () => {
        throw new Error("branch failed");
      })],
    });
    const successful = loop({
      id: "successful-child",
      steps: [createRuntimeStep("complete", async () => {
        await Promise.resolve();
        successfulBranchSettled = true;
        return done({ value: "ok" });
      })],
    });
    const parent = loop({
      id: "testing.failed-fork-parent",
      steps: [
        forkWorkflowStep({
          id: "fork-work",
          input: { source: textSchema },
          output: { joined: textSchema },
          branches: () => [
            createWorkflowForkBranch({
              id: "failed",
              workflow: { documentId: "failed-child", id: "failed-child" },
              childInput: {},
              createWorkflow: failed,
              mapResult: () => "unreachable",
            }),
            createWorkflowForkBranch({
              id: "successful",
              workflow: { documentId: "successful-child", id: "successful-child" },
              childInput: {},
              createWorkflow: successful,
              mapResult: (session) => textSchema.parse(session.state.value),
            }),
          ] as const,
          join: () => ({ joined: "unreachable" }),
        }),
      ],
    });

    await expect(parent.start({ source: "response" })).rejects.toBeInstanceOf(WorkflowForkError);
    expect(successfulBranchSettled).toBe(true);
  });
});
