import type {
  EventRecord,
  WorkflowRunArtifactRef,
} from "../core/index.js";
import type {
  JsonObject,
  JsonValue,
} from "../shared/json.js";
import type {
  WorkflowAppResumeHookInput,
  WorkflowAppRunOrigin,
  WorkflowAppRunSnapshot,
  WorkflowAppStartRunInput,
  WorkflowAppWorkflowDescriptor,
} from "../client/interactions/workflow-app.js";
import type { SignalDescriptor } from "../authoring/signal.js";

export type TriggerType = "block" | "event" | "http" | "manual" | "schedule" | "webhook";

export type TriggerAuthDescriptor = {
  mode: "bearer" | "none";
  tokenRef?: string;
};

export type TriggerInputDescriptor = {
  contentType?: "application/json" | string;
  jsonRender?: unknown;
  jsonSchema?: unknown;
  mode: "body" | "envelope";
};

export type TriggerDescriptor = {
  auth?: TriggerAuthDescriptor;
  config?: {
    method?: string;
    path?: string;
    [key: string]: unknown;
  };
  description?: string;
  enabled: boolean;
  id: string;
  input?: TriggerInputDescriptor;
  label: string;
  source?: {
    documentPath?: string;
    triggerId?: string;
    [key: string]: unknown;
  };
  type: TriggerType;
  workflowId: string;
};

export type TriggerRegistryDocument = {
  triggers: TriggerDescriptor[];
  version: number;
};

export type TriggerRegistryStore = {
  read(): Promise<TriggerRegistryDocument>;
  write?(document: TriggerRegistryDocument): Promise<void>;
};

export type TriggerJobStatus =
  | "claimed"
  | "completed"
  | "dead"
  | "failed"
  | "queued"
  | "retrying"
  | "running";

export type TriggerJobKind = "timer" | "trigger";

export type TriggerInvocationJobPayload = {
  http?: SafeHttpEnvelope;
  input: unknown;
  source?: string;
};

export type TimerJobPayload = {
  http?: undefined;
  input?: undefined;
  runId: string;
  source: "timer";
  token: string;
};

export type TriggerJobPayload =
  | TimerJobPayload
  | TriggerInvocationJobPayload;

export type SafeHttpEnvelope = {
  headers?: Record<string, string>;
  method: string;
  path: string;
  query?: Record<string, string | string[]>;
  receivedAt: string;
};

export type TriggerJobSnapshot = {
  attempts: number;
  availableAt: string;
  createdAt: string;
  error?: string;
  id: string;
  idempotencyKey?: string;
  kind?: TriggerJobKind;
  leaseId?: string;
  lockedBy?: string;
  lockedUntil?: string;
  maxAttempts: number;
  occurrenceId: string;
  payload: TriggerJobPayload;
  runId?: string;
  status: TriggerJobStatus;
  triggerId: string;
  updatedAt: string;
  workflowId: string;
};

export type RuntimeRetentionSummary = {
  afterBytes: number;
  beforeBytes: number;
  deletedEvents: number;
  deletedJobs: number;
  deletedRuns: number;
  workflowId: string;
};

export type RuntimeRetentionResult = {
  maxBytesPerWorkflow: number;
  workflows: RuntimeRetentionSummary[];
};

export type TriggerJobFilter = {
  kind?: TriggerJobKind;
  status?: TriggerJobStatus | TriggerJobStatus[];
  triggerId?: string;
  workflowId?: string;
};

export type EnqueueTriggerInput = {
  bearerToken?: string;
  idempotencyKey?: string;
  input: unknown;
  http?: SafeHttpEnvelope;
  source?: string;
  trusted?: boolean;
  triggerId: string;
};

export type EnqueueScheduledTriggerOccurrenceInput = {
  availableAt: string;
  idempotencyKey: string;
  occurrenceId: string;
  triggerId: string;
};

export type EnqueueTriggerResult = {
  created: boolean;
  job: TriggerJobSnapshot;
};

export type ClaimTriggerJobInput = {
  leaseMs?: number;
  workerId: string;
};

export type CompleteTriggerJobInput = {
  jobId: string;
  leaseId?: string;
  reason?: string;
  runId?: string;
};

export type RetryTriggerJobInput = {
  jobId: string;
  retryDelayMs?: number;
};

export type DeadLetterTriggerJobInput = {
  error?: string;
  jobId: string;
};

export type CancelTriggerJobInput = {
  reason?: string;
  jobId: string;
};

export type FailTriggerJobInput = {
  error: string;
  jobId: string;
  leaseId?: string;
  retry?: boolean;
  retryDelayMs?: number;
};

export type AuthorizeWorkflowControlPlaneInput = {
  bearerToken?: string;
  capability: string;
  triggerId?: string;
};

export type PruneRuntimeInput = {
  maxBytesPerWorkflow: number;
};

export type WatchOptions = {
  fromIndex?: number;
  intervalMs?: number;
};

export type TriggerJobEvent = {
  index: number;
  job: TriggerJobSnapshot;
  timestamp: string;
  type: "trigger.job.changed";
};

export type AuthTokenVerifier = {
  verifyBearer(input: {
    capability: string;
    token: string;
    trigger?: TriggerDescriptor;
  }): Promise<boolean> | boolean;
};

export type IdGenerator = {
  id(prefix: string): string;
};

export type Clock = {
  now(): Date;
};

export type WorkflowRunFilter = {
  originType?: WorkflowAppRunOrigin["type"];
  workflowId?: string;
};

export type StoredWorkflowRunSnapshot = WorkflowAppRunSnapshot;

export type PutWorkflowRunResult = {
  /** True when the submitted snapshot is current (newly stored or already identical). */
  accepted: boolean;
  /** The authoritative snapshot after the atomic write attempt. */
  snapshot: StoredWorkflowRunSnapshot;
};

export type PutArtifactContentInput = {
  artifactId: string;
  content: string;
  kind: string;
  mediaType?: string;
  metadata?: JsonObject;
  title?: string;
};

export type StoredArtifactContent = {
  content: string;
  createdAt: string;
  ref: WorkflowRunArtifactRef;
};

export type DatasetStoreDefinition = {
  key: string[];
  name: string;
  schemaFingerprint: string;
  version: number;
};

export type DatasetRow = JsonObject;

export type DatasetUpsertRowsInput = DatasetStoreDefinition & {
  rows: DatasetRow[];
};

export type DatasetUpsertRowsResult = {
  inserted: number;
  updated: number;
};

export type DatasetRowsQuery = {
  filter?: Record<string, JsonValue>;
  limit?: number;
  offset?: number;
};

export type DatasetRegistryEntry = {
  freshness?: string;
  name: string;
  rowCount: number;
  version: number;
};

export type RuntimeStoreEnqueueInput = {
  availableAt: string;
  createdAt: string;
  id: string;
  idempotencyKey?: string;
  kind?: TriggerJobKind;
  maxAttempts: number;
  occurrenceId: string;
  payload: TriggerJobPayload;
  payloadHash?: string;
  status: TriggerJobStatus;
  triggerId: string;
  updatedAt: string;
  workflowId: string;
};

export type SignalOccurrenceStatus = "pending" | "claimed" | "delivered" | "failed";

export type SignalOccurrenceReceipt = {
  attempts: number;
  createdAt: string;
  error?: string;
  id: string;
  occurredAt: string;
  signalId: string;
  status: SignalOccurrenceStatus;
  updatedAt: string;
};

export type StoredSignalOccurrence = SignalOccurrenceReceipt & {
  correlation: JsonValue;
  correlationHash: string;
  idempotencyKey: string;
  lockedBy?: string;
  lockedUntil?: string;
  payload: JsonValue;
  payloadHash: string;
  runId?: string;
  waitToken?: string;
};

export type SignalWaitSnapshot = {
  contractFingerprint: string;
  correlation: JsonValue;
  correlationHash: string;
  createdAt: string;
  runId: string;
  signalId: string;
  status: "pending" | "claimed" | "consumed";
  stepId: string;
  token: string;
  updatedAt: string;
};

export type PutSignalOccurrenceInput = {
  correlation: JsonValue;
  correlationHash: string;
  createdAt: string;
  id: string;
  idempotencyKey: string;
  occurredAt: string;
  payload: JsonValue;
  payloadHash: string;
  signalId: string;
  updatedAt: string;
};

export type PutSignalOccurrenceResult = {
  created: boolean;
  occurrence: StoredSignalOccurrence;
};

export type SignalDeliveryClaim = {
  occurrence: StoredSignalOccurrence;
  wait: SignalWaitSnapshot;
};

export type PublishSignalOccurrenceInput = {
  bearerToken?: string;
  correlation: unknown;
  idempotencyKey: string;
  occurredAt?: string;
  payload: unknown;
  signalId: string;
};

export type PublishSignalOccurrenceResult = {
  created: boolean;
  receipt: SignalOccurrenceReceipt;
};

export type WorkflowRuntimeStore = {
  appendWorkflowRunEvents(runId: string, events: EventRecord[]): Promise<void> | void;
  claimNextTriggerJob(input: {
    leaseMs: number;
    now: string;
    workerId: string;
  }): Promise<TriggerJobSnapshot | undefined> | TriggerJobSnapshot | undefined;
  claimNextSignalDelivery(input: {
    leaseMs: number;
    now: string;
    workerId: string;
  }): Promise<SignalDeliveryClaim | undefined> | SignalDeliveryClaim | undefined;
  completeSignalDelivery(input: {
    now: string;
    occurrenceId: string;
    runId: string;
    waitToken: string;
  }): Promise<StoredSignalOccurrence> | StoredSignalOccurrence;
  completeTriggerJob(input: {
    jobId: string;
    leaseId?: string;
    now: string;
    reason?: string;
    runId?: string;
  }): Promise<TriggerJobSnapshot> | TriggerJobSnapshot;
  cancelTriggerJob(input: {
    error: string;
    jobId: string;
    now: string;
  }): Promise<TriggerJobSnapshot> | TriggerJobSnapshot;
  deadLetterTriggerJob(input: {
    error: string;
    jobId: string;
    now: string;
  }): Promise<TriggerJobSnapshot> | TriggerJobSnapshot;
  enqueueTriggerJob(input: RuntimeStoreEnqueueInput): Promise<EnqueueTriggerResult> | EnqueueTriggerResult;
  failTriggerJob(input: {
    error: string;
    jobId: string;
    leaseId?: string;
    now: string;
    retry: boolean;
    retryDelayMs: number;
  }): Promise<TriggerJobSnapshot> | TriggerJobSnapshot;
  failSignalDelivery(input: {
    error: string;
    now: string;
    occurrenceId: string;
    retry: boolean;
  }): Promise<StoredSignalOccurrence> | StoredSignalOccurrence;
  getSignalOccurrence(id: string): Promise<StoredSignalOccurrence | undefined> | StoredSignalOccurrence | undefined;
  getTriggerJob(id: string): Promise<TriggerJobSnapshot | undefined> | TriggerJobSnapshot | undefined;
  getArtifactContent?(artifactId: string): Promise<StoredArtifactContent | undefined> | StoredArtifactContent | undefined;
  getWorkflowRun(id: string): Promise<StoredWorkflowRunSnapshot | undefined> | StoredWorkflowRunSnapshot | undefined;
  heartbeatTriggerJob?(input: {
    jobId: string;
    leaseId?: string;
    leaseMs: number;
    now: string;
  }): Promise<TriggerJobSnapshot> | TriggerJobSnapshot;
  countDatasetRows?(definition: DatasetStoreDefinition): Promise<number> | number;
  datasetFreshness?(definition: DatasetStoreDefinition): Promise<string | undefined> | string | undefined;
  listDatasets?(): Promise<DatasetRegistryEntry[]> | DatasetRegistryEntry[];
  listArtifactRefs?(runId: string): Promise<WorkflowRunArtifactRef[]> | WorkflowRunArtifactRef[];
  listTriggerJobs(filter?: TriggerJobFilter): Promise<TriggerJobSnapshot[]> | TriggerJobSnapshot[];
  listWorkflowRuns(filter?: WorkflowRunFilter): Promise<StoredWorkflowRunSnapshot[]> | StoredWorkflowRunSnapshot[];
  markTriggerJobRunning(input: {
    jobId: string;
    leaseId?: string;
    now: string;
    runId: string;
  }): Promise<TriggerJobSnapshot> | TriggerJobSnapshot;
  putArtifactContent?(input: PutArtifactContentInput): Promise<void> | void;
  /** Atomically preserves the newest run revision and rejects stale regressions. */
  putWorkflowRun(snapshot: StoredWorkflowRunSnapshot): Promise<PutWorkflowRunResult> | PutWorkflowRunResult;
  putSignalOccurrence(input: PutSignalOccurrenceInput): Promise<PutSignalOccurrenceResult> | PutSignalOccurrenceResult;
  pruneRuntime(input: PruneRuntimeInput): Promise<RuntimeRetentionResult> | RuntimeRetentionResult;
  queryDatasetRows?(definition: DatasetStoreDefinition, query?: DatasetRowsQuery): Promise<DatasetRow[]> | DatasetRow[];
  recordArtifactRef?(runId: string, artifact: WorkflowRunArtifactRef): Promise<void> | void;
  retryTriggerJob(input: {
    availableAt: string;
    jobId: string;
    now: string;
  }): Promise<TriggerJobSnapshot> | TriggerJobSnapshot;
  syncSignalWaits(input: {
    now: string;
    runId: string;
    waits: SignalWaitSnapshot[];
  }): Promise<void> | void;
  upsertDatasetRows?(input: DatasetUpsertRowsInput): Promise<DatasetUpsertRowsResult> | DatasetUpsertRowsResult;
};

export type WorkflowControlPlane = {
  answerQuestion(runId: string, input: { questionId: string; value: unknown }): Promise<WorkflowAppRunSnapshot>;
  authorize(input: AuthorizeWorkflowControlPlaneInput): Promise<void>;
  cancelTriggerJob(input: CancelTriggerJobInput): Promise<TriggerJobSnapshot>;
  claimNextTriggerJob(input: ClaimTriggerJobInput): Promise<TriggerJobSnapshot | undefined>;
  completeTriggerJob(input: CompleteTriggerJobInput): Promise<TriggerJobSnapshot>;
  deadLetterTriggerJob(input: DeadLetterTriggerJobInput): Promise<TriggerJobSnapshot>;
  enqueueScheduledTriggerOccurrence(input: EnqueueScheduledTriggerOccurrenceInput): Promise<EnqueueTriggerResult>;
  enqueueTrigger(input: EnqueueTriggerInput): Promise<EnqueueTriggerResult>;
  failTriggerJob(input: FailTriggerJobInput): Promise<TriggerJobSnapshot>;
  getRun(runId: string): Promise<WorkflowAppRunSnapshot>;
  getSignal(id: string): Promise<SignalDescriptor>;
  getSignalOccurrence(id: string): Promise<SignalOccurrenceReceipt>;
  getTrigger(id: string): Promise<TriggerDescriptor>;
  getTriggerJob(id: string): Promise<TriggerJobSnapshot>;
  getWorkflow(id: string): Promise<WorkflowAppWorkflowDescriptor>;
  heartbeatTriggerJob?(input: {
    jobId: string;
    leaseId?: string;
    leaseMs?: number;
  }): Promise<TriggerJobSnapshot>;
  listRuns(filter?: WorkflowRunFilter): Promise<WorkflowAppRunSnapshot[]>;
  listSignals(): Promise<SignalDescriptor[]>;
  listTriggerJobs(filter?: TriggerJobFilter): Promise<TriggerJobSnapshot[]>;
  listTriggers(): Promise<TriggerDescriptor[]>;
  listWorkflows(): Promise<WorkflowAppWorkflowDescriptor[]>;
  pruneRuntime(input: PruneRuntimeInput): Promise<RuntimeRetentionResult>;
  publishSignalOccurrence(input: PublishSignalOccurrenceInput): Promise<PublishSignalOccurrenceResult>;
  resumeHook(input: WorkflowAppResumeHookInput): Promise<WorkflowAppRunSnapshot>;
  resumeRun(runId: string): Promise<WorkflowAppRunSnapshot>;
  retryTriggerJob(input: RetryTriggerJobInput): Promise<TriggerJobSnapshot>;
  startRun(input: WorkflowAppStartRunInput): Promise<WorkflowAppRunSnapshot>;
  startRunFromTriggerJob(jobId: string, leaseId?: string): Promise<WorkflowAppRunSnapshot>;
  watchRun(runId: string, options?: WatchOptions): AsyncIterable<EventRecord>;
  watchTriggerJob(jobId: string, options?: WatchOptions): AsyncIterable<TriggerJobEvent>;
};
