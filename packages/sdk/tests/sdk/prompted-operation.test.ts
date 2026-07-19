import {
  describe,
  expect,
  test,
} from "bun:test";
import { z } from "zod";

import {
  defineIdCatalog,
  defineOperationContract,
  definePromptedOperation,
  runPromptedOperation,
  zodOperationContract,
} from "@dromio/workflow/core";

describe("prompted operations", () => {
  test("parses contracts and emits execution lifecycle events", async () => {
    const ids = defineIdCatalog({
      operation: { classify: "test.classify" },
    } as const);
    const events: string[] = [];
    const operation = definePromptedOperation({
      execute(input) {
        return { answer: input.prompt.toUpperCase() };
      },
      id: ids.operation.classify,
      input: zodOperationContract("test.classify.input", z.object({ prompt: z.string() })),
      output: zodOperationContract("test.classify.output", z.object({ answer: z.string() })),
    });

    const result = await runPromptedOperation({
      input: { prompt: "ship" },
      onEvent(event) {
        events.push(event.type);
      },
      operation,
      trace: {
        spanId: "operation:test.classify",
        traceId: "run_prompted_operation",
      },
    });

    expect(result.output.answer).toBe("SHIP");
    expect(events).toEqual([
      "operation.started",
      "operation.progress",
      "output.parsed",
      "operation.completed",
    ]);
  });

  test("rejects invalid input before executing", async () => {
    let executed = false;
    const operation = definePromptedOperation({
      execute() {
        executed = true;
        return {};
      },
      id: "test.validation",
      input: zodOperationContract("test.validation.input", z.object({ prompt: z.string() })),
      output: defineOperationContract({ id: "test.validation.output" }),
    });

    await expect(runPromptedOperation({
      input: { prompt: 123 },
      operation,
    })).rejects.toThrow("Operation contract test.validation.input failed");
    expect(executed).toBe(false);
  });

  test("does not hide evaluation or gate lifecycle inside execution", async () => {
    const events: string[] = [];
    const operation = definePromptedOperation({
      execute() {
        return { answer: "draft" };
      },
      id: "test.no-hidden-evaluation",
      input: zodOperationContract("test.no-hidden-evaluation.input", z.object({ prompt: z.string() })),
      output: zodOperationContract("test.no-hidden-evaluation.output", z.object({ answer: z.string() })),
    });

    await runPromptedOperation({
      input: { prompt: "ship" },
      onEvent(event) {
        events.push(event.type);
      },
      operation,
    });

    expect(events).not.toContain("score.gated");
    expect(events).not.toContain("evaluation.completed");
    expect(events).not.toContain("operation.decision");
  });

  test("derives contract ids from operation id for raw schemas", async () => {
    const events: Array<{ contractId?: unknown; outputContractId?: unknown; type: string }> = [];
    const operation = definePromptedOperation({
      execute(input) {
        return JSON.stringify({ answer: input.prompt.toUpperCase() });
      },
      id: "test.derived",
      input: z.object({ prompt: z.string() }),
      output: z.object({ answer: z.string() }),
    });

    const result = await runPromptedOperation({
      input: { prompt: "ship" },
      onEvent(event) {
        if (event.type !== "operation.started") return;
        const detail = event.detail as { contractId?: unknown; outputContractId?: unknown };
        events.push({
          contractId: detail.contractId,
          outputContractId: detail.outputContractId,
          type: event.type,
        });
      },
      operation,
    });

    expect(result.output.answer).toBe("SHIP");
    expect(events[0]).toEqual({
      contractId: "test.derived.input",
      outputContractId: "test.derived.output",
      type: "operation.started",
    });
  });
});
