import {
  toJsonObject,
  toJsonValue,
  type JsonObject,
  type JsonValue,
} from "../../shared/json.js";
import type {
  EventRecord,
  HookRequest,
} from "../loop/index.js";
import type {
  RuntimeSessionSnapshot,
  RuntimeStatus,
} from "./runtime.types.js";

export type WorkflowRunStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "queued"
  | "running"
  | "suspended";

export type WorkflowRunOwner = {
  displayName?: string;
  id: string;
  kind: "agent" | "organization" | "service" | "team" | "user";
};

export type WorkflowUnitDefinition<TMetadata extends JsonObject = JsonObject> = {
  definitionId: string;
  description?: string;
  inputSchema?: JsonObject;
  metadata?: TMetadata;
  outputSchema?: JsonObject;
  title?: string;
  version: string;
};

export type WorkflowRunLineage = {
  childRunId?: string;
  childWorkflowId?: string;
  parentRunId?: string;
  parentStepId?: string;
  path: string[];
  resumeToken?: string;
};

export type WorkflowRunArtifactRef<TMetadata extends JsonObject = JsonObject> = {
  artifactId: string;
  kind: string;
  mediaType?: string;
  metadata?: TMetadata;
  title?: string;
  uri?: string;
};

export type WorkflowRunScoreState = {
  gateId?: string;
  label?: string;
  score: number;
  status: "failed" | "passed" | "pending";
  threshold?: number;
};

export type WorkflowSuspensionKind =
  | "artifact_review"
  | "blocked"
  | "handoff_requested"
  | "low_score"
  | "needs_approval"
  | "needs_clarification";

export type WorkflowSuspensionResumeTarget = {
  runId: string;
  stepId?: string;
  token: string;
};

export type WorkflowRunSuspension<TSchema extends JsonObject = JsonObject> = {
  actor: WorkflowRunOwner;
  child?: WorkflowRunLineage;
  expiresAt?: string;
  kind: WorkflowSuspensionKind;
  metadata?: JsonObject;
  prompt: string;
  relatedArtifacts: WorkflowRunArtifactRef[];
  resumeTarget: WorkflowSuspensionResumeTarget;
  schema?: TSchema;
  suspensionId: string;
  traceRefs: string[];
};

export type WorkflowRunApproval = {
  actor: WorkflowRunOwner;
  approvalId: string;
  decidedAt?: string;
  status: "approved" | "pending" | "rejected";
  suspensionId?: string;
};

export type WorkflowRunQuestion<TSchema extends JsonObject = JsonObject> = {
  actor: WorkflowRunOwner;
  prompt: string;
  questionId: string;
  schema?: TSchema;
  status: "answered" | "pending" | "rejected";
};

export type WorkflowRunEvent<TPayload extends JsonObject = JsonObject> = {
  eventId: string;
  index: number;
  occurredAt: string;
  payload: TPayload;
  runId: string;
  type: string;
};

export type WorkflowRunSnapshot<
  TInput extends JsonValue = JsonValue,
  TState extends JsonObject = JsonObject,
> = {
  approvals: WorkflowRunApproval[];
  artifacts: WorkflowRunArtifactRef[];
  childRuns: WorkflowRunLineage[];
  createdAt: string;
  definition: WorkflowUnitDefinition;
  events: WorkflowRunEvent[];
  input: TInput;
  lineage?: WorkflowRunLineage;
  owner: WorkflowRunOwner;
  questions: WorkflowRunQuestion[];
  runId: string;
  scores: WorkflowRunScoreState[];
  state: TState;
  status: WorkflowRunStatus;
  stepResults: Record<string, JsonValue>;
  suspensions: WorkflowRunSuspension[];
  traceRefs: string[];
  updatedAt: string;
};

export type WorkflowUnitRun = {
  definitionId: string;
  owner: WorkflowRunOwner;
  runId: string;
  status: WorkflowRunStatus;
};

export type WorkflowRunSnapshotFromRuntimeSessionInput = {
  approvals?: WorkflowRunApproval[];
  artifacts?: WorkflowRunArtifactRef[];
  childRuns?: WorkflowRunLineage[];
  createdAt?: string;
  definition: WorkflowUnitDefinition;
  hookSuspensionKind?: (hook: HookRequest) => WorkflowSuspensionKind;
  lineage?: WorkflowRunLineage;
  owner: WorkflowRunOwner;
  scores?: WorkflowRunScoreState[];
  session: RuntimeSessionSnapshot;
  suspensions?: WorkflowRunSuspension[];
  traceRefs?: string[];
  updatedAt?: string;
};

export type DurableRunStoreCapabilities = {
  supportsArtifactRefs: boolean;
  supportsAtomicRunUpdates: boolean;
  supportsChildRunIndexes: boolean;
  supportsEventReplay: boolean;
  supportsLeases: boolean;
};

export type DurableRunStoreCapability = keyof DurableRunStoreCapabilities;

export type WorkflowRunLease = {
  leaseId: string;
  ownerId: string;
  runId: string;
  stepId?: string;
  validUntil: string;
};

export type WorkflowRunObserveOptions = {
  fromIndex?: number;
};

export type WorkflowRunControlInput<TPayload extends JsonObject = JsonObject> = {
  actor: WorkflowRunOwner;
  payload: TPayload;
  runId: string;
};

export type DurableWorkflowRunStore = {
  appendEvents(runId: string, events: WorkflowRunEvent[]): Promise<void> | void;
  capabilities: DurableRunStoreCapabilities;
  createRun(snapshot: WorkflowRunSnapshot): Promise<WorkflowUnitRun> | WorkflowUnitRun;
  listRuns(filter?: { definitionId?: string; ownerId?: string; status?: WorkflowRunStatus }): Promise<WorkflowUnitRun[]> | WorkflowUnitRun[];
  loadChildRunLineage(runId: string): Promise<WorkflowRunLineage[]> | WorkflowRunLineage[];
  loadSnapshot(runId: string): Promise<WorkflowRunSnapshot | undefined> | WorkflowRunSnapshot | undefined;
  observeRun(runId: string, options?: WorkflowRunObserveOptions): AsyncIterable<WorkflowRunEvent>;
  persistSnapshot(snapshot: WorkflowRunSnapshot): Promise<void> | void;
  recordApproval(input: WorkflowRunControlInput<{ approvalId: string; status: "approved" | "rejected"; suspensionId?: string }>): Promise<void> | void;
  recordArtifactRef(runId: string, artifact: WorkflowRunArtifactRef): Promise<void> | void;
  recordQuestion(input: WorkflowRunControlInput<{ answer?: JsonValue; questionId: string; status: "answered" | "pending" | "rejected" }>): Promise<void> | void;
  recordScore(runId: string, score: WorkflowRunScoreState): Promise<void> | void;
  updateRunStatus(runId: string, status: WorkflowRunStatus): Promise<void> | void;
};

export function missingDurableRunStoreCapabilities(
  store: Pick<DurableWorkflowRunStore, "capabilities">,
  required: DurableRunStoreCapability[],
): DurableRunStoreCapability[] {
  return required.filter((capability) => !store.capabilities[capability]);
}

export function assertDurableRunStoreCapabilities(
  store: Pick<DurableWorkflowRunStore, "capabilities">,
  required: DurableRunStoreCapability[],
  context = "durable workflow runtime",
): void {
  const missing = missingDurableRunStoreCapabilities(store, required);
  if (missing.length > 0) {
    throw new Error(
      `${context} requires durable run store capabilities: ${missing.join(", ")}`,
    );
  }
}

export function workflowRunStatusFromRuntimeStatus(status: RuntimeStatus): WorkflowRunStatus {
  switch (status) {
    case "cancelled":
      return "cancelled";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "idle":
      return "queued";
    case "paused":
    case "waiting":
      return "suspended";
    case "running":
      return "running";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function workflowRunSnapshotFromRuntimeSession(
  input: WorkflowRunSnapshotFromRuntimeSessionInput,
): WorkflowRunSnapshot {
  const firstTimestamp = input.session.events[0]?.timestamp;
  const lastTimestamp = input.session.events.at(-1)?.timestamp;
  const createdAt = input.createdAt ?? firstTimestamp ?? new Date().toISOString();
  const lineage = input.lineage ?? workflowRunLineageFromRuntimeSession(input.session);
  const suspensions = input.suspensions ?? input.session.pendingHooks.map((hook) =>
    workflowRunSuspensionFromHook({
      hook,
      kind: input.hookSuspensionKind?.(hook) ?? workflowSuspensionKindFromHook(hook),
      owner: input.owner,
      runId: input.session.runId,
    })
  );

  return {
    approvals: input.approvals ?? [],
    artifacts: input.artifacts ?? [],
    childRuns: input.childRuns ?? [],
    createdAt,
    definition: input.definition,
    events: input.session.events.map(workflowRunEventFromRuntimeEvent),
    input: toJsonValue(input.session.input),
    ...(lineage ? { lineage } : {}),
    owner: input.owner,
    questions: workflowRunQuestionsFromRuntimeSession(input.session, input.owner),
    runId: input.session.runId,
    scores: input.scores ?? [],
    state: toJsonObject(input.session.state),
    status: workflowRunStatusFromRuntimeStatus(input.session.status),
    stepResults: toJsonObject(input.session.state),
    suspensions,
    traceRefs: input.traceRefs ?? traceRefsFromRuntimeEvents(input.session.events),
    updatedAt: input.updatedAt ?? lastTimestamp ?? createdAt,
  };
}

function workflowRunEventFromRuntimeEvent(event: EventRecord): WorkflowRunEvent {
  return {
    eventId: event.correlationId,
    index: event.index,
    occurredAt: event.timestamp,
    payload: toJsonObject(event),
    runId: event.runId,
    type: event.type,
  };
}

function workflowRunLineageFromRuntimeSession(
  session: RuntimeSessionSnapshot,
): WorkflowRunLineage | undefined {
  if (!session.parentRunId) return undefined;
  return {
    childRunId: session.runId,
    childWorkflowId: session.workflowKey,
    parentRunId: session.parentRunId,
    parentStepId: session.parentCheckpointId,
    path: [session.parentRunId, session.runId],
  };
}

function workflowRunSuspensionFromHook(input: {
  hook: HookRequest;
  kind: WorkflowSuspensionKind;
  owner: WorkflowRunOwner;
  runId: string;
}): WorkflowRunSuspension {
  const prompt = hookPrompt(input.hook);
  return {
    actor: input.owner,
    ...(input.hook.expiresAt ? { expiresAt: input.hook.expiresAt } : {}),
    kind: input.kind,
    metadata: toJsonObject({
      correlationId: input.hook.correlationId,
      hookId: input.hook.id,
      sourceKind: input.hook.kind,
    }),
    prompt,
    relatedArtifacts: [],
    resumeTarget: {
      runId: input.runId,
      stepId: input.hook.stepId,
      token: input.hook.token,
    },
    ...(input.hook.schema ? { schema: toJsonObject(input.hook.schema) } : {}),
    suspensionId: input.hook.token,
    traceRefs: [input.hook.correlationId],
  };
}

function workflowSuspensionKindFromHook(hook: HookRequest): WorkflowSuspensionKind {
  switch (hook.kind) {
    case "approval":
    case "human_approval":
    case "needs_approval":
      return "needs_approval";
    case "artifact_review":
    case "review":
      return "artifact_review";
    case "clarification":
    case "needs_clarification":
    case "question":
      return "needs_clarification";
    case "handoff":
    case "handoff_requested":
      return "handoff_requested";
    case "low_score":
      return "low_score";
    case "blocked":
    default:
      return "blocked";
  }
}

function workflowRunQuestionsFromRuntimeSession(
  session: RuntimeSessionSnapshot,
  owner: WorkflowRunOwner,
): WorkflowRunQuestion[] {
  return session.pendingQuestions.map((question, index) => {
    const jsonQuestion = toJsonObject(question);
    const questionId = typeof jsonQuestion.id === "string" ? jsonQuestion.id : `question-${index}`;
    const prompt = typeof jsonQuestion.prompt === "string" ? jsonQuestion.prompt : questionId;
    return {
      actor: owner,
      prompt,
      questionId,
      schema: jsonQuestion,
      status: "pending",
    };
  });
}

function hookPrompt(hook: HookRequest): string {
  if (hook.title) return hook.title;
  const input = toJsonObject(hook.input);
  if (typeof input.prompt === "string") return input.prompt;
  if (typeof input.title === "string") return input.title;
  return hook.id;
}

function traceRefsFromRuntimeEvents(events: EventRecord[]): string[] {
  return [...new Set(events.flatMap((event) => event.trace?.traceId ?? []))];
}
