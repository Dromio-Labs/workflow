import type {
  IntentContract,
  IntentRequirement,
  IntentStep,
  Question,
} from "../intent/index.js";

export type CapabilityMatchContext = {
  intent: IntentContract;
  requirement(id: string): IntentRequirement | undefined;
  requirementValue(ids: string | string[], defaultValue?: unknown): unknown;
  requirements: Map<string, IntentRequirement>;
  step: IntentStep;
};

export type Capability<TIntentId extends string = string> = {
  description?: string;
  id: string;
  intent: TIntentId;
  input?: unknown;
  mapInput?: (context: CapabilityMatchContext) => Record<string, unknown>;
  match?: (context: CapabilityMatchContext) => boolean;
  metadata?: Record<string, unknown>;
  order?: number;
  title: string;
};

export type PlanItem = {
  capabilityId: string;
  id: string;
  input: Record<string, unknown>;
  intent: string;
  kind: "trigger" | "action";
  title: string;
};

export type PlanEdge = {
  branch?: string;
  from: string;
  id: string;
  to: string;
};

export type CapabilityPlan = {
  edges: PlanEdge[];
  items: PlanItem[];
};

export type MissingCapability = {
  intent: string;
  label: string;
  stepId: string;
};

export type CapabilityMatch = {
  missingCapabilities: MissingCapability[];
  plan: CapabilityPlan;
  questions: Question[];
};

export type CapabilityCatalog = {
  items: Capability[];
  match(intent: IntentContract): Promise<CapabilityMatch>;
};

export type ArtifactFactory<TArtifact = unknown> = {
  create(plan: CapabilityPlan): Promise<TArtifact> | TArtifact;
};

export type RunnerCheck = {
  ok: boolean;
  reason?: string;
};

export type RunnerRun = {
  runId: string;
  status: "running" | "completed" | "paused" | "cancelled" | "failed";
};

export type RunnerTraceEvent = {
  message: string;
  nodeId?: string;
  type: string;
};

export type ArtifactRunner<TArtifact = unknown> = {
  cancel?(runId: string): Promise<RunnerRun> | RunnerRun;
  check(artifact: TArtifact): Promise<RunnerCheck> | RunnerCheck;
  pause?(runId: string): Promise<RunnerRun> | RunnerRun;
  resume?(runId: string): Promise<RunnerRun> | RunnerRun;
  run(artifact: TArtifact): Promise<RunnerRun> | RunnerRun;
  trace?(runId: string): AsyncIterable<RunnerTraceEvent>;
};
