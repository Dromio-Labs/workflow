import type { CandidateEvaluation } from "../../core/index.js";
import type { CapabilityCatalog, CapabilityPlan } from "../builder/index.js";
import type { IntentContract } from "../intent/index.js";
import type {
  WorkflowArtifactArgs,
  WorkflowBuilderConfig,
  WorkflowRunResult,
} from "./workflow.types.js";

export type WorkflowUse<TArtifact> = {
  artifact: {
    create(args: WorkflowArtifactArgs): Promise<TArtifact> | TArtifact;
  };
  capabilities: CapabilityCatalog;
  checkArtifact?: WorkflowBuilderConfig<TArtifact>["checkArtifact"];
  evaluateCandidate?: WorkflowBuilderConfig<TArtifact>["evaluateCandidate"];
  runArtifact?: WorkflowBuilderConfig<TArtifact>["runArtifact"];
};

export type WorkflowState<TArtifact> = {
  artifact?: TArtifact;
  candidateEvaluation?: CandidateEvaluation;
  intent?: IntentContract;
  plan?: CapabilityPlan;
  result?: WorkflowRunResult;
};
