import type {
  JsonObject,
} from "../../shared/json.js";
import type {
  AgentRuntimeContext,
} from "./types.js";

export type RuntimeToolEffect = "external" | "read" | "write";

export type RuntimeToolApprovalPolicy = "always" | "never" | "on-risky";

export type RuntimeToolDescriptor = {
  approval: RuntimeToolApprovalPolicy;
  description: string;
  effect: RuntimeToolEffect;
  id: string;
  inputSchema: unknown;
  outputSchema: unknown;
  workflowId: string;
};

export type RuntimeTool<
  TInput = unknown,
  TOutput = unknown,
  TState extends JsonObject = JsonObject,
  TDescriptor extends RuntimeToolDescriptor = RuntimeToolDescriptor,
> = TDescriptor & {
  run(context: AgentRuntimeContext<TState>, input: unknown): Promise<TOutput>;
};

export type WorkflowToolSchema<TValue> = {
  definition: unknown;
  parse(value: unknown): TValue;
};

export type CreateWorkflowToolInput<
  TInput,
  TOutput,
  TState extends JsonObject = JsonObject,
  TDescriptor extends RuntimeToolDescriptor = RuntimeToolDescriptor,
> = {
  descriptor: TDescriptor;
  input: WorkflowToolSchema<TInput>;
  output: WorkflowToolSchema<TOutput>;
  run(context: AgentRuntimeContext<TState>, input: TInput): Promise<TOutput> | TOutput;
};

export type WorkflowToolRegistry<TTool extends RuntimeTool = RuntimeTool> = {
  find(id: string): TTool | null;
  list(): TTool[];
};

export function createWorkflowTool<
  TInput,
  TOutput,
  TState extends JsonObject = JsonObject,
  TDescriptor extends RuntimeToolDescriptor = RuntimeToolDescriptor,
>(
  input: CreateWorkflowToolInput<TInput, TOutput, TState, TDescriptor>,
): RuntimeTool<TInput, TOutput, TState, TDescriptor> {
  return {
    ...input.descriptor,
    inputSchema: input.input.definition,
    outputSchema: input.output.definition,
    run: async (context, value) => {
      const parsedInput = input.input.parse(value);
      await context.emit?.({
        toolId: input.descriptor.id,
        input: parsedInput,
        type: "tool.started",
        workflowId: input.descriptor.workflowId,
      });
      try {
        const output = await input.run(context, parsedInput);
        const parsedOutput = input.output.parse(output);
        await context.emit?.({
          toolId: input.descriptor.id,
          output: parsedOutput,
          type: "tool.completed",
          workflowId: input.descriptor.workflowId,
        });
        return parsedOutput;
      } catch (error) {
        await context.emit?.({
          toolId: input.descriptor.id,
          error: error instanceof Error ? error.message : String(error),
          type: "tool.failed",
          workflowId: input.descriptor.workflowId,
        });
        throw error;
      }
    },
  };
}

export function createWorkflowTools<
  TInput,
  TOutput,
  TState extends JsonObject = JsonObject,
  TDescriptor extends RuntimeToolDescriptor = RuntimeToolDescriptor,
>(
  inputs: Array<CreateWorkflowToolInput<TInput, TOutput, TState, TDescriptor>>,
): Array<RuntimeTool<TInput, TOutput, TState, TDescriptor>> {
  return inputs.map(createWorkflowTool);
}

export function createWorkflowToolRegistry<TTool extends RuntimeTool>(
  tools: TTool[],
): WorkflowToolRegistry<TTool> {
  const byId = new Map<string, TTool>();
  for (const tool of tools) {
    if (byId.has(tool.id)) {
      throw new Error(`Duplicate workflow tool id: ${tool.id}`);
    }
    byId.set(tool.id, tool);
  }
  return {
    find: (id) => byId.get(id) ?? null,
    list: () => [...tools],
  };
}

export function createWorkflowSchemaAdapter<TValue>(
  definition: unknown,
  parse: (value: unknown) => TValue,
): WorkflowToolSchema<TValue> {
  return {
    definition,
    parse,
  };
}
