import { describe, expect, test } from "bun:test";
import { ask, done, loop, createRuntimeStep } from "@dromio/workflow/core";
import {
  forEachWorkflowStep,
  workflowStep,
} from "../../src/sdk/product/step/workflow-step.js";
import { z } from "zod";

const textSchema = z.string().min(1);

describe("workflow product steps", () => {
  test("composes one child workflow as one contracted parent step", async () => {
    const child = loop<unknown, { value: string }>({
      id: "testing.single-child",
      steps: [
        createRuntimeStep<unknown, { value: string }>("uppercase", ({ emit, input, step: runtimeStep }) => {
          emit({
            detail: { operationId: "testing.uppercase" },
            message: "Uppercased value.",
            trace: {
              attributes: { operationId: "testing.uppercase" },
              kind: "internal",
              name: "testing.uppercase",
              parentSpanId: `step:${runtimeStep.id}:attempt:${runtimeStep.attempt}`,
              spanId: "operation:testing.uppercase",
              status: "ok",
              traceId: runtimeStep.runId,
            },
            type: "operation.completed",
          });
          return done({ result: input.value.toUpperCase() });
        }),
      ],
    });
    const parent = loop({
      id: "testing.single-parent",
      steps: [
        workflowStep({
          childInput: ({ input }) => ({ value: input.source }),
          createWorkflow: child,
          id: "run-child",
          input: { source: textSchema },
          mapOutput: (session) => ({ result: textSchema.parse(session.state.result) }),
          output: { result: textSchema },
          workflow: { documentId: "testing.single-child", id: "testing.single-child" },
        }),
      ],
    });

    const session = await parent.start({ source: "dromio" });

    expect(session.state.result).toBe("DROMIO");
    expect(session.events.find((event) => event.type === "step.completed" && event.stepId === "run-child.uppercase"))
      .toMatchObject({
      detail: expect.objectContaining({
        childWorkflowId: "testing.single-child",
        parentStepId: "run-child",
      }),
      trace: expect.objectContaining({
        parentSpanId: "step:run-child:attempt:1",
        spanId: "child:run-child:step:uppercase:attempt:1",
        traceId: session.runId,
      }),
    });
    expect(session.events.find((event) => event.type === "operation.completed")).toMatchObject({
      trace: expect.objectContaining({
        parentSpanId: "child:run-child:step:uppercase:attempt:1",
        spanId: "child:run-child:operation:testing.uppercase",
        traceId: session.runId,
      }),
    });
  });

  test("runs a child workflow sequentially for each item and collects output", async () => {
    const order: string[] = [];
    const child = (item: string) => loop<unknown, { value: string }>({
      id: "testing.item-child",
      steps: [
        createRuntimeStep<unknown, { value: string }>("record", ({ input }) => {
          order.push(input.value);
          return done({ value: input.value });
        }),
      ],
    });
    const parent = loop({
      id: "testing.for-each-parent",
      steps: [
        forEachWorkflowStep({
          childInput: (item: string) => ({ value: item }),
          collect: (results) => ({
            result: results.map((result) => {
              if (result.status !== "completed") throw result.error;
              return textSchema.parse(result.session.state.value);
            }).join(","),
          }),
          createWorkflow: (item: string) => child(item),
          id: "run-items",
          input: { source: textSchema },
          itemId: (item: string) => item,
          itemKind: "word",
          items: ({ input }) => input.source.split(" "),
          output: { result: textSchema },
          workflow: { documentId: "testing.item-child", id: "testing.item-child" },
        }),
      ],
    });

    const session = await parent.start({ source: "one two" });

    expect(order).toEqual(["one", "two"]);
    expect(session.state.result).toBe("one,two");
    expect(session.events.filter((event) => event.type === "step.completed" && event.stepId?.endsWith(".record")))
      .toHaveLength(2);
    expect(session.events.filter((event) => event.type === "step.completed" && event.stepId?.endsWith(".record"))
      .map((event) => event.stepId)).toEqual([
        "run-items.one.record",
        "run-items.two.record",
      ]);
  });

  test("scopes repeated item workflow identities by their parent step", async () => {
    const child = loop({
      id: "testing.reused-child",
      steps: [createRuntimeStep("record", () => done({ value: "ok" }))],
    });
    const createParentStep = (id: string) => forEachWorkflowStep({
      childInput: () => ({}),
      collect: () => ({ result: "ok" }),
      createWorkflow: () => child,
      id,
      input: { source: textSchema },
      itemId: () => "same-item",
      items: () => ["same-item"],
      output: { result: textSchema },
      workflow: { documentId: "testing.reused-child", id: "testing.reused-child" },
    });
    const parent = loop({
      id: "testing.reused-parent",
      steps: [createParentStep("first-batch"), createParentStep("second-batch")],
    });

    const session = await parent.start({ source: "value" });
    const completed = session.events.filter((event) =>
      event.type === "step.completed" && event.stepId?.endsWith("same-item.record")
    );

    expect(completed.map((event) => event.stepId)).toEqual([
      "first-batch.same-item.record",
      "second-batch.same-item.record",
    ]);
    expect(new Set(completed.map((event) => event.trace?.spanId)).size).toBe(2);
  });

  test("rejects a runtime workflow whose id differs from its reference", async () => {
    const child = loop({ id: "testing.actual-child", steps: [createRuntimeStep("done", () => done())] });
    const parent = loop({
      id: "testing.identity-parent",
      steps: [
        workflowStep({
          childInput: () => ({}),
          createWorkflow: child,
          id: "run-child",
          input: { source: textSchema },
          mapOutput: () => ({ result: "unreachable" }),
          output: { result: textSchema },
          workflow: { documentId: "testing.expected-child", id: "testing.expected-child" },
        }),
      ],
    });

    await expect(parent.start({ source: "value" })).rejects.toThrow(
      "testing.expected-child resolved runtime workflow testing.actual-child",
    );
  });

  test("reports nested waiting as an unsupported parent-step failure", async () => {
    const child = loop({
      id: "testing.waiting-child",
      steps: [createRuntimeStep("question", () => ask({
        id: "approval",
        prompt: "Continue?",
        title: "Approval",
        type: "text",
      }))],
    });
    const parent = loop({
      id: "testing.waiting-parent",
      steps: [
        workflowStep({
          childInput: () => ({}),
          createWorkflow: child,
          id: "run-child",
          input: { source: textSchema },
          mapOutput: () => ({ result: "unreachable" }),
          output: { result: textSchema },
          workflow: { documentId: "testing.waiting-child", id: "testing.waiting-child" },
        }),
      ],
    });

    await expect(parent.start({ source: "value" })).rejects.toThrow("waiting for input");
  });

  test("propagates a failed child workflow by default", async () => {
    const child = loop({
      id: "testing.failed-child",
      steps: [createRuntimeStep("fail", () => {
        throw new Error("child failed");
      })],
    });
    const parent = loop({
      id: "testing.failed-parent",
      steps: [
        workflowStep({
          childInput: () => ({}),
          createWorkflow: child,
          id: "run-child",
          input: { source: textSchema },
          mapOutput: () => ({ result: "unreachable" }),
          output: { result: textSchema },
          workflow: { documentId: "testing.failed-child", id: "testing.failed-child" },
        }),
      ],
    });

    await expect(parent.start({ source: "value" })).rejects.toThrow("child failed");
  });

  test("collects failed iterations only when continueOnError is enabled", async () => {
    const child = (item: string) => loop({
      id: "testing.fallible-child",
      steps: [createRuntimeStep("process", () => {
        if (item === "bad") throw new Error("bad item");
        return done({ value: item });
      })],
    });
    const parent = loop({
      id: "testing.continue-parent",
      steps: [
        forEachWorkflowStep({
          childInput: (item: string) => ({ item }),
          collect: (results) => ({ result: results.map((result) => result.status).join(",") }),
          continueOnError: true,
          createWorkflow: (item: string) => child(item),
          id: "run-items",
          input: { source: textSchema },
          itemId: (item: string) => item,
          items: ({ input }) => input.source.split(" "),
          output: { result: textSchema },
          workflow: { documentId: "testing.fallible-child", id: "testing.fallible-child" },
        }),
      ],
    });

    const session = await parent.start({ source: "good bad last" });

    expect(session.status).toBe("completed");
    expect(session.state.result).toBe("completed,failed,completed");
  });
});
