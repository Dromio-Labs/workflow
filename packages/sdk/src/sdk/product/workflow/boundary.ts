import type {
  LoopBoundary,
  StepContractSourceMap,
} from "../../core/index.js";

export type WorkflowTriggerType =
  | "block"
  | "event"
  | "manual"
  | "schedule"
  | "webhook";

export type WorkflowTriggerInput<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
  config?: TConfig;
  description?: string;
  id: string;
  input?: StepContractSourceMap;
  label?: string;
};

export type WorkflowScheduleTriggerConfig = {
  cron: string;
  timezone?: string;
};

export type WorkflowWebhookTriggerConfig = {
  mockRequest?: unknown;
  path?: string;
  schema?: unknown;
};

export type WorkflowEventTriggerConfig = Record<string, unknown>;

export type WorkflowBlockTriggerConfig = {
  interval: number;
  network: string;
};

export type WorkflowEndInput<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
  config?: TConfig;
  description?: string;
  id: string;
  label?: string;
  output?: StepContractSourceMap;
};

export type WorkflowTriggerBoundary = LoopBoundary & {
  boundary: "trigger";
  type: WorkflowTriggerType;
};

export type WorkflowEndBoundary = LoopBoundary & {
  boundary: "end";
};

export const trigger = {
  block(input: WorkflowTriggerInput<WorkflowBlockTriggerConfig>): WorkflowTriggerBoundary {
    return triggerBoundary("block", input);
  },
  event(input: WorkflowTriggerInput<WorkflowEventTriggerConfig>): WorkflowTriggerBoundary {
    return triggerBoundary("event", input);
  },
  manual(input: WorkflowTriggerInput = { id: "manual" }): WorkflowTriggerBoundary {
    return triggerBoundary("manual", input);
  },
  schedule(input: WorkflowTriggerInput<WorkflowScheduleTriggerConfig>): WorkflowTriggerBoundary {
    return triggerBoundary("schedule", input);
  },
  webhook(input: WorkflowTriggerInput<WorkflowWebhookTriggerConfig>): WorkflowTriggerBoundary {
    return triggerBoundary("webhook", input);
  },
};

export const end = {
  result(input: WorkflowEndInput): WorkflowEndBoundary {
    return {
      boundary: "end",
      ...(input.config ? { config: input.config } : {}),
      description: input.description,
      id: input.id,
      label: input.label,
      output: input.output,
      type: "result",
    };
  },
};

function triggerBoundary(
  type: WorkflowTriggerType,
  input: WorkflowTriggerInput,
): WorkflowTriggerBoundary {
  return {
    boundary: "trigger",
    ...(input.config ? { config: input.config } : {}),
    description: input.description,
    id: input.id,
    input: input.input,
    label: input.label,
    type,
  };
}
