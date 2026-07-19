import { describe, expect, test } from "bun:test";
import { step } from "@dromio/workflow";
import { loop } from "@dromio/workflow/core";
import {
  createModelRouter,
  modelWorkerBackend,
  promptText,
  type ModelWorkerCompleteInput,
} from "@dromio/workflow/product";
import { z } from "zod";

const requestSchema = z.object({ prompt: z.string() });
const planSchema = z.object({ value: z.string() });

describe("model router", () => {
  test("routes a root model step through declared refs and run overrides", async () => {
    const calls: Array<{ modelId: string; operation: string }> = [];
    const router = createModelRouter({
      workers: {
        mock: modelWorkerBackend({
          create({ modelId }) {
            return {
              async complete(input: ModelWorkerCompleteInput) {
                calls.push({ modelId, operation: input.operation });
                return JSON.stringify({ plan: { value: `from ${modelId}` } });
              },
              async completeJson() {
                throw new Error("JSON completion is not used by step.model().");
              },
            };
          },
        }),
      },
      models: {
        "mock.agent": { label: "Mock agent", model: "agent", worker: "mock" },
        "mock.judge": { label: "Mock judge", model: "judge", worker: "mock" },
      },
    });
    router.select({
      modelId: "mock.judge",
      operation: "draft",
      runId: "run_router",
      stepId: "draft-plan",
    });
    const draft = step.model({
      id: "draft-plan",
      input: { request: requestSchema },
      model: router.use("mock.agent"),
      operation: "draft",
      output: { plan: planSchema },
      prompt: promptText("Draft."),
    });
    const workflow = loop({ id: "router.workflow", steps: [draft.create()] });
    const session = await workflow.start({ request: { prompt: "ship" } }, { runId: "run_router" });

    expect(session.status).toBe("completed");
    expect(session.state.plan).toEqual({ value: "from mock.judge" });
    expect(calls).toEqual([{ modelId: "mock.judge", operation: "draft-plan" }]);
    expect(workflow.graph().nodes[0]?.models?.[0]?.requested?.id).toBe("mock.agent");
  });
});
