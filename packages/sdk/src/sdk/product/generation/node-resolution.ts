import { z } from "zod";
import {
  done,
  createContractedRuntimeStep,
} from "../../core/index.js";
import type {
  WorkflowCatalog,
} from "../catalog/index.js";

export const workflowNodeNeedSchema = z.object({
  capabilities: z.array(z.string().trim().min(1)).optional(),
  desiredOutputKeys: z.array(z.string().trim().min(1)).optional(),
  inputKeys: z.array(z.string().trim().min(1)).optional(),
  intent: z.string().trim().min(1),
  sideEffects: z.array(z.string().trim().min(1)).optional(),
  verbs: z.array(z.string().trim().min(1)).optional(),
});

export const workflowNodeResolutionCandidateSchema = z.object({
  catalogItemId: z.string(),
  label: z.string(),
  reasons: z.array(z.string()),
  score: z.number(),
});

export const workflowNodeResolutionSchema = z.object({
  candidates: z.array(workflowNodeResolutionCandidateSchema),
  catalogItemId: z.string().optional(),
  decision: z.enum(["generate-custom", "use-catalog"]),
  reasons: z.array(z.string()),
  score: z.number(),
});

export type WorkflowNodeNeed = z.infer<typeof workflowNodeNeedSchema>;
export type WorkflowNodeResolutionCandidate = z.infer<typeof workflowNodeResolutionCandidateSchema>;
export type WorkflowNodeResolution = z.infer<typeof workflowNodeResolutionSchema>;

export type ResolveWorkflowNodeInput = {
  catalog: WorkflowCatalog;
  need: WorkflowNodeNeed;
  threshold?: number;
};

export function resolveWorkflowNodeFromCatalog(input: ResolveWorkflowNodeInput): WorkflowNodeResolution {
  const candidates = input.catalog.search(input.need)
    .map((candidate) => ({
      catalogItemId: candidate.item.id,
      label: candidate.item.label,
      reasons: candidate.reasons,
      score: candidate.score,
    }));
  const best = candidates[0];
  const threshold = input.threshold ?? 12;
  if (!best || best.score < threshold) {
    return {
      candidates,
      decision: "generate-custom",
      reasons: best
        ? [`Best catalog match scored ${best.score}, below threshold ${threshold}.`]
        : ["No catalog candidates matched the requested node need."],
      score: best?.score ?? 0,
    };
  }
  return {
    candidates,
    catalogItemId: best.catalogItemId,
    decision: "use-catalog",
    reasons: best.reasons,
    score: best.score,
  };
}

export function createResolveWorkflowNodeStep(input: {
  catalog: WorkflowCatalog;
  id?: string;
  label?: string;
  threshold?: number;
}) {
  return createContractedRuntimeStep({
    id: input.id ?? "resolve-node",
    input: {
      need: workflowNodeNeedSchema,
    },
    label: input.label ?? "Resolve catalog node",
    output: {
      nodeResolution: workflowNodeResolutionSchema,
    },
    run(context) {
      return done({
        nodeResolution: resolveWorkflowNodeFromCatalog({
          catalog: input.catalog,
          need: context.input.need,
          threshold: input.threshold,
        }),
      });
    },
  });
}
