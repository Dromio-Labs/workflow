import { expect, test } from "bun:test";
import { z } from "zod";

import { step, workflow } from "@dromio/workflow";
import { loop } from "@dromio/workflow/core";

const childInputSchema = z.object({ fail: z.boolean(), value: z.number() });
const childOutputSchema = z.object({ value: z.number() });
const childInputJsonSchema = z.toJSONSchema(childInputSchema);
const childOutputJsonSchema = z.toJSONSchema(childOutputSchema);
const childWorkflowConfig: { multiplier: number } = { multiplier: 1 };

const multiply = step({
  config: {
    defaults: { multiplier: 1 },
    resolve: (defaults, placement) => ({ ...defaults, ...placement }) as { multiplier: number },
  },
  id: "test.multiply",
  input: { item: childInputSchema },
  output: { result: childOutputSchema },
  run({ config, input }) {
    if (input.item.fail) throw new Error(`failed-${input.item.value}`);
    return { result: { value: input.item.value * config.multiplier } };
  },
});

const child = workflow({
  catalog: [multiply],
  config: childWorkflowConfig,
  document: {
    edges: [
      { id: "request->multiply", source: "request", target: "multiply" },
      { id: "multiply->ready", source: "multiply", target: "ready" },
    ],
    end: {
      id: "ready",
      output: { result: { jsonSchema: childOutputJsonSchema } },
      type: "result",
    },
    id: "test-child",
    nodes: [{ catalogItemId: "test.multiply", id: "multiply" }],
    trigger: {
      id: "request",
      input: { item: { jsonSchema: childInputJsonSchema } },
      type: "manual",
    },
    version: 1,
  },
  input: { item: childInputSchema },
  output: { result: childOutputSchema },
});

test("advanced step.forEach owns configuration, typed child output, and failures", async () => {
  const completed: number[] = [];
  const failed: string[] = [];
  const each = step.forEach({
    childInput: (item: { fail: boolean; value: number }) => ({ item }),
    collect: (results) => ({
      summary: {
        completed: results.filter((result) => result.status === "completed").length,
        failed: results.filter((result) => result.status === "failed").length,
      },
    }),
    config: {
      defaults: { multiplier: 3 },
    },
    continueOnError: true,
    id: "test.for-each-advanced",
    input: { items: z.array(childInputSchema) },
    items: ({ input }) => input.items,
    onItemCompleted({ output }) {
      completed.push(output.result.value);
    },
    onItemFailed({ error }) {
      failed.push(error instanceof Error ? error.message : String(error));
    },
    output: {
      summary: z.object({ completed: z.number(), failed: z.number() }),
    },
    prepare: ({ config }) => config,
    workflow: child,
    workflowConfig: ({ prepared }) => prepared,
  });
  const parent = loop({ id: "test-parent", steps: [each.create()] });

  const session = await parent.start({
    items: [
      { fail: false, value: 2 },
      { fail: true, value: 4 },
    ],
  });

  expect(session.status).toBe("completed");
  expect(session.state.summary).toEqual({ completed: 1, failed: 1 });
  expect(completed).toEqual([6]);
  expect(failed).toEqual(["failed-4"]);
});
