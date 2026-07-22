import { z } from "zod";

export const workflowDocumentTriggerTypeSchema = z.enum([
  "block",
  "event",
  "manual",
  "schedule",
  "webhook",
]);

export const workflowDocumentContractSchema = z.object({
  description: z.string().optional(),
  jsonSchema: z.unknown().optional(),
});

export const workflowDocumentContractMapSchema = z.record(
  z.string().trim().min(1),
  workflowDocumentContractSchema,
);

export const workflowDocumentTriggerSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
  id: z.string().trim().min(1),
  input: workflowDocumentContractMapSchema.optional(),
  label: z.string().optional(),
  type: workflowDocumentTriggerTypeSchema,
}).superRefine((value, context) => {
  if (value.type === "schedule") {
    if (typeof value.config?.cron !== "string" || value.config.cron.trim().length === 0) {
      context.addIssue({
        code: "custom",
        message: "Schedule triggers require config.cron.",
        path: ["config", "cron"],
      });
    }
  }
  if (value.type === "block") {
    if (typeof value.config?.network !== "string" || value.config.network.trim().length === 0) {
      context.addIssue({
        code: "custom",
        message: "Block triggers require config.network.",
        path: ["config", "network"],
      });
    }
    if (typeof value.config?.interval !== "number" || value.config.interval < 1) {
      context.addIssue({
        code: "custom",
        message: "Block triggers require config.interval greater than or equal to 1.",
        path: ["config", "interval"],
      });
    }
  }
});

export const workflowDocumentEndSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
  id: z.string().trim().min(1),
  label: z.string().optional(),
  output: workflowDocumentContractMapSchema.optional(),
  type: z.string().optional(),
});

export const workflowDocumentNodeKindSchema = z.enum([
  "adapter",
  "approval",
  "builtin",
  "composite",
  "delegate",
  "evaluation",
  "forEach",
  "fork",
  "gate",
  "model",
  "primitive",
  "question",
  "router",
  "step",
  "wait",
  "workflow",
]);

export const workflowDocumentPortBindingMapSchema = z.record(
  z.string().trim().min(1),
  z.string().trim().min(1),
);

export const workflowDocumentNodeBindingsSchema = z.object({
  input: workflowDocumentPortBindingMapSchema.optional(),
  output: workflowDocumentPortBindingMapSchema.optional(),
});

export const workflowDocumentNodeSchema = z.object({
  bindings: workflowDocumentNodeBindingsSchema.optional(),
  catalogItemId: z.string().trim().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
  id: z.string().trim().min(1),
  kind: workflowDocumentNodeKindSchema.optional(),
  label: z.string().optional(),
  role: z.string().trim().min(1).optional(),
});

export const workflowDocumentEdgeSchema = z.object({
  id: z.string().trim().min(1),
  source: z.string().trim().min(1),
  target: z.string().trim().min(1),
});

export const workflowDocumentLoopSchema = z.object({
  backTo: z.string().trim().min(1).optional(),
  end: z.string().trim().min(1),
  id: z.string().trim().min(1),
  label: z.string().optional(),
  start: z.string().trim().min(1),
});

export const workflowDocumentSchema = z.object({
  description: z.string().optional(),
  edges: z.array(workflowDocumentEdgeSchema),
  end: workflowDocumentEndSchema,
  id: z.string().trim().min(1),
  label: z.string().optional(),
  loops: z.array(workflowDocumentLoopSchema).optional(),
  nodes: z.array(workflowDocumentNodeSchema),
  trigger: workflowDocumentTriggerSchema,
  version: z.literal(1).default(1),
});

export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;
export type WorkflowDocumentContract = z.infer<typeof workflowDocumentContractSchema>;
export type WorkflowDocumentEdge = z.infer<typeof workflowDocumentEdgeSchema>;
export type WorkflowDocumentEnd = z.infer<typeof workflowDocumentEndSchema>;
export type WorkflowDocumentLoop = z.infer<typeof workflowDocumentLoopSchema>;
export type WorkflowDocumentNode = z.infer<typeof workflowDocumentNodeSchema>;
export type WorkflowDocumentNodeBindings = z.infer<typeof workflowDocumentNodeBindingsSchema>;
export type WorkflowDocumentNodeKind = z.infer<typeof workflowDocumentNodeKindSchema>;
export type WorkflowDocumentTrigger = z.infer<typeof workflowDocumentTriggerSchema>;
export type WorkflowDocumentTriggerType = z.infer<typeof workflowDocumentTriggerTypeSchema>;
