import type {
  ArtifactRunner,
  Capability,
  CapabilityCatalog,
  CapabilityPlan,
  RunnerCheck,
} from "../builder/index.js";
import type {
  EventPayload,
  EventRecord,
  EventSink,
  LoopCheckpoint,
  LoopBoundary,
  LoopStatus,
  HookRequest,
} from "../../core/loop/index.js";
import type {
  CandidateEvaluation,
  Question,
  QuestionResolverRegistry,
} from "../../core/index.js";
import type {
  Domain,
  IntentContract,
} from "../intent/index.js";

export type WorkflowEvent = EventRecord;

export type WorkflowArtifactArgs = {
  emit: (event: EventPayload) => void;
  intent: IntentContract;
  plan: CapabilityPlan;
};

export type WorkflowRunArgs<TArtifact> = {
  artifact: TArtifact;
  emit: (event: EventPayload) => void;
  intent: IntentContract;
  plan: CapabilityPlan;
};

export type WorkflowCheckArgs<TArtifact> = {
  artifact: TArtifact;
  intent: IntentContract;
  plan: CapabilityPlan;
};

export type WorkflowRunResult = {
  runId?: string;
  status?: string;
  [key: string]: unknown;
};

export type WorkflowBuilderConfig<TArtifact> = {
  capabilities: Capability[] | CapabilityCatalog;
  checkArtifact?: (args: WorkflowCheckArgs<TArtifact>) => Promise<RunnerCheck> | RunnerCheck;
  createArtifact: (args: WorkflowArtifactArgs) => Promise<TArtifact> | TArtifact;
  domain: Domain;
  evaluateCandidate?: (args: WorkflowRunArgs<TArtifact>) => Promise<CandidateEvaluation> | CandidateEvaluation;
  description?: string;
  end?: LoopBoundary;
  id?: string;
  label?: string;
  questionResolvers?: QuestionResolverRegistry;
  runArtifact?: (args: WorkflowRunArgs<TArtifact>) => Promise<WorkflowRunResult | void> | WorkflowRunResult | void;
  stepView?: WorkflowBuilderStepViewMap;
  trigger?: LoopBoundary;
};

export type WorkflowBuilderStepView = {
  description?: string;
  label?: string;
};

export type WorkflowBuilderStepViewMap = Record<string, WorkflowBuilderStepView>;

export type WorkflowRunInput = {
  answers?: Record<string, unknown>;
  fromIndex?: number;
  onQuestion?: (question: Question) => Promise<unknown> | unknown;
  onEvent?: EventSink;
  prompt: string;
  questionResolvers?: QuestionResolverRegistry;
  runId?: string;
};

export type WorkflowRunOutput<TArtifact> = {
  artifact?: TArtifact;
  checkpoints: Array<LoopCheckpoint<{ prompt: string }>>;
  events: WorkflowEvent[];
  pendingHooks: HookRequest[];
  candidateEvaluation?: CandidateEvaluation;
  intent?: IntentContract;
  pendingQuestions: Question[];
  plan?: CapabilityPlan;
  result?: WorkflowRunResult;
  runId: string;
  status: LoopStatus;
};

export type WorkflowRunner<TArtifact> = ArtifactRunner<TArtifact>;
