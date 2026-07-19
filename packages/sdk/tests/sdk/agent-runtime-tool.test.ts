import { describe, expect, test } from "bun:test";
import {
  type AgentRuntimeContextEvent,
  type AgentRuntimeContext,
  createWorkflowTools,
  createWorkflowTool,
  createWorkflowToolRegistry,
  createWorkflowSchemaAdapter,
} from "@dromio/workflow/agents/runtime";

describe("workflow runtime tools", () => {
  test("parses untrusted input before invoking the workflow runner", async () => {
    let runCount = 0;
    const tool = createEchoTool({
      run: (_context, input) => {
        runCount += 1;
        return { echo: input.prompt.toUpperCase() };
      },
    });

    await expect(tool.run({ state: {} }, { prompt: 42 })).rejects.toThrow("prompt must be a string");
    expect(runCount).toBe(0);
    expect(await tool.run({ state: {} }, { prompt: "ship it" })).toEqual({ echo: "SHIP IT" });
    expect(runCount).toBe(1);
  });

  test("parses workflow output before reporting tool completion", async () => {
    const tool = createEchoTool({
      run: () => ({ echo: 42 }) as never,
    });

    await expect(tool.run({ state: {} }, { prompt: "ship it" })).rejects.toThrow("echo must be a string");
  });

  test("registers workflow tools by stable id", () => {
    const tool = createEchoTool({
      run: (_context, input) => ({ echo: input.prompt }),
    });
    const registry = createWorkflowToolRegistry(createWorkflowTools([{
      descriptor: echoDescriptor,
      input: echoInputSchema,
      output: echoOutputSchema,
      run: (_context, input) => ({ echo: input.prompt }),
    }]));

    expect(registry.find("workflow.echo.run")?.workflowId).toBe("echo");
    expect(registry.find("missing")).toBeNull();
    expect(registry.list()).toHaveLength(1);
    expect(() => createWorkflowToolRegistry([tool, tool])).toThrow(
      "Duplicate workflow tool id: workflow.echo.run",
    );
  });

  test("emits tool lifecycle events around workflow execution", async () => {
    const events: AgentRuntimeContextEvent[] = [];
    const tool = createEchoTool({
      run: (_context, input) => ({ echo: input.prompt }),
    });

    await expect(tool.run({
      emit: (event) => {
        events.push(event);
      },
      state: {},
    }, { prompt: "ship it" })).resolves.toEqual({ echo: "ship it" });

    expect(events).toEqual([
      {
        toolId: "workflow.echo.run",
        input: { prompt: "ship it" },
        type: "tool.started",
        workflowId: "echo",
      },
      {
        toolId: "workflow.echo.run",
        output: { echo: "ship it" },
        type: "tool.completed",
        workflowId: "echo",
      },
    ]);
  });

  test("emits tool failure events when execution or output parsing fails", async () => {
    const events: AgentRuntimeContextEvent[] = [];
    const tool = createEchoTool({
      run: () => {
        throw new Error("workflow failed");
      },
    });

    await expect(tool.run({
      emit: (event) => {
        events.push(event);
      },
      state: {},
    }, { prompt: "ship it" })).rejects.toThrow("workflow failed");

    expect(events).toEqual([
      {
        toolId: "workflow.echo.run",
        input: { prompt: "ship it" },
        type: "tool.started",
        workflowId: "echo",
      },
      {
        toolId: "workflow.echo.run",
        error: "workflow failed",
        type: "tool.failed",
        workflowId: "echo",
      },
    ]);
  });
});

const echoInputSchema = createWorkflowSchemaAdapter(
  {
    properties: {
      prompt: { type: "string" },
    },
    required: ["prompt"],
    type: "object",
  },
  (value: unknown): { prompt: string } => {
    if (!value || typeof value !== "object" || typeof (value as { prompt?: unknown }).prompt !== "string") {
      throw new Error("prompt must be a string");
    }
    return {
      prompt: (value as { prompt: string }).prompt,
    };
  },
);

const echoOutputSchema = createWorkflowSchemaAdapter(
  {
    properties: {
      echo: { type: "string" },
    },
    required: ["echo"],
    type: "object",
  },
  (value: unknown): { echo: string } => {
    if (!value || typeof value !== "object" || typeof (value as { echo?: unknown }).echo !== "string") {
      throw new Error("echo must be a string");
    }
    return {
      echo: (value as { echo: string }).echo,
    };
  },
);

const echoDescriptor = {
  approval: "never",
  description: "Echo a prompt through a workflow.",
  effect: "read",
  id: "workflow.echo.run",
  inputSchema: echoInputSchema.definition,
  outputSchema: echoOutputSchema.definition,
  workflowId: "echo",
} as const;

function createEchoTool(input: {
  run(
    context: AgentRuntimeContext,
    input: { prompt: string },
  ): { echo: string } | Promise<{ echo: string }>;
}) {
  return createWorkflowTool({
    descriptor: echoDescriptor,
    input: echoInputSchema,
    output: echoOutputSchema,
    run: input.run,
  });
}
