import type { Domain } from "../../product/intent/index.js";
import type { CandidateNextAction } from "../evaluation/index.js";
import type {
  InferOperationContractSource,
  OperationContract,
  OperationContractSourceLike,
} from "../prompted-operation/contracts.js";
import type {
  Question,
  QuestionResolutionHistoryItem,
  QuestionResolverRegistry,
} from "../questions/index.js";
import type {
  WorkflowHookRenderHint,
} from "@dromio/workflow-room-protocol";
import type {
  StepOperationContext,
  StepOperationInput,
} from "./operation.types.js";

export type TraceAttributeValue =
  | boolean
  | number
  | string
  | Array<boolean | number | string>;

export type TraceContext = {
  attributes?: Record<string, TraceAttributeValue>;
  kind?: "internal" | "producer" | "consumer" | "client";
  name: string;
  parentSpanId?: string;
  spanId: string;
  status?: "unset" | "ok" | "error";
  traceId: string;
};

export type EventPayload = {
  attempt?: number;
  correlationId?: string;
  detail?: unknown;
  index?: number;
  message: string;
  runId?: string;
  stepId?: string;
  trace?: TraceContext;
  type: string;
  [key: string]: unknown;
};

export type EventRecord = EventPayload & {
  correlationId: string;
  index: number;
  runId: string;
  timestamp: string;
};

export type EventSink = (event: EventRecord) => void | Promise<void>;

export type StepState = Record<string, unknown>;

export type WorkerItemEventType =
  | "worker.item.started"
  | "worker.item.delta"
  | "worker.item.completed"
  | "worker.item.failed";

export type WorkerItemEvent = EventPayload & {
  error?: string;
  input?: unknown;
  itemId: string;
  itemKind: string;
  output?: unknown;
  parentItemId?: string;
  preview: string;
  provider: string;
  providerRefs?: Record<string, string | undefined>;
  raw?: unknown;
  rawType?: string;
  text?: string;
  title: string;
  type: WorkerItemEventType;
};

export type WorkerItemEventInput =
  Omit<WorkerItemEvent, "message"> &
  { message?: string };

export type CommandRunEventType =
  | "command.completed"
  | "command.failed"
  | "command.output"
  | "command.started";

export type CommandRunEvent = EventPayload & {
  command: string;
  commandId: string;
  cwd?: string;
  durationMs?: number;
  exitCode?: number;
  output?: string;
  stderr?: string;
  stdout?: string;
  title: string;
  transcriptRef?: string;
  type: CommandRunEventType;
};

export type CommandRunEventInput =
  Omit<CommandRunEvent, "message"> &
  { message?: string };

export type LoopStatus =
  | "idle"
  | "running"
  | "waiting"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type DoneStepResult<TOutput = unknown> = {
  output?: TOutput;
  state?: StepState;
  type: "done";
};

export type StepResult<TOutput = unknown> =
  | DoneStepResult<TOutput>
  | { questions: Question[]; state?: StepState; type: "ask" }
  | { reason: string; state?: StepState; type: "retry" }
  | { reason?: string; state?: StepState; stepId: string; type: "goto" }
  | { error: string; state?: StepState; type: "fail" };

export type StepContext<TUse = unknown, TInput = unknown> = {
  answers: Record<string, unknown>;
  emit: (event: EventPayload) => void;
  input: TInput;
  operation<T>(
    input: StepOperationInput,
    run: (context: StepOperationContext) => Promise<T> | T,
  ): Promise<T>;
  sleep(input: SleepOptions): Promise<SleepFiredValue>;
  state: StepState;
  step: StepRuntimeMetadata;
  use: TUse;
  waitFor<TInput = unknown, TOutput = unknown>(
    hook: HookDefinition<TInput, TOutput>,
    input: TInput,
  ): Promise<TOutput>;
};

export type StepContractSourceMap = Record<string, OperationContractSourceLike>;
export type StepContractRecord = Record<string, OperationContract<unknown, string>>;

export type InferStepContractInput<TContracts> =
  TContracts extends StepContractSourceMap
    ? { [K in keyof TContracts]: InferOperationContractSource<TContracts[K]> }
    : Record<string, never>;

export type InferStepContractOutput<TContracts> =
  TContracts extends StepContractSourceMap
    ? { [K in keyof TContracts]: InferOperationContractSource<TContracts[K]> }
    : unknown;

export type ContractedStepContext<
  TUse,
  TWorkflowInput,
  TInputContracts,
> = Omit<StepContext<TUse, TWorkflowInput>, "input"> & {
  input: InferStepContractInput<TInputContracts>;
  workflowInput: TWorkflowInput;
};

export type StepRuntimeMetadata = {
  attempt: number;
  correlationId: string;
  id: string;
  idempotencyKey: string;
  runId: string;
  workflowId: string;
};

export type StepDefinition<TUse = unknown, TInput = unknown> = {
  description?: string;
  id: string;
  input?: StepContractRecord;
  kind?: string;
  label?: string;
  maxRetries?: number;
  models?: StepModelOperation[];
  output?: StepContractRecord;
  run: (context: StepContext<TUse, TInput>) => Promise<StepResult> | StepResult;
};

export type StepOptions = {
  description?: string;
  input?: StepContractSourceMap;
  kind?: string;
  label?: string;
  maxRetries?: number;
  models?: StepModelOperation[];
  output?: StepContractSourceMap;
};

export type StepModelOperation = {
  label?: string;
  operation: string;
  prompt?: StepPromptSource;
  requested?: StepModelRef;
};

export type StepPromptSource =
  | {
      kind: "file";
      path: string;
    }
  | {
      kind: "loader";
    }
  | {
      kind: "text";
      preview: string;
    };

export type StepModelRef = {
  capabilities?: string[];
  id: string;
  label?: string;
  model?: string;
  worker?: string;
};

export type ContractedStepOptions<
  TUse,
  TWorkflowInput,
  TInputContracts extends StepContractSourceMap | undefined,
  TOutputContracts extends StepContractSourceMap | undefined,
> = Omit<StepOptions, "input" | "output"> & {
  id: string;
  input?: TInputContracts;
  output?: TOutputContracts;
  run: (
    context: ContractedStepContext<TUse, TWorkflowInput, TInputContracts>,
  ) =>
    | Promise<StepResult<InferStepContractOutput<TOutputContracts>>>
    | StepResult<InferStepContractOutput<TOutputContracts>>;
};

export type HookDefinition<TInput = unknown, TOutput = unknown> = {
  expiresAt?: string;
  id: string;
  input?: TInput;
  kind?: string;
  render?: WorkflowHookRenderHint;
  schema?: unknown;
  title?: string;
  _output?: TOutput;
};

export type HookRequest<TInput = unknown> = {
  correlationId: string;
  expiresAt?: string;
  id: string;
  input: TInput;
  kind?: string;
  render?: WorkflowHookRenderHint;
  schema?: unknown;
  stepId: string;
  title?: string;
  token: string;
};

export type HookResume<TOutput = unknown> = {
  token: string;
  value: TOutput;
};

export type SleepFiredValue = {
  firedAt: string;
};

export type SleepOptions = {
  id?: string;
} & (
  | {
      ms: number;
      until?: never;
    }
  | {
      ms?: never;
      until: Date | string;
    }
);

export type LoopCheckpoint<TInput = unknown> = {
  attempt: number;
  checkpointId: string;
  eventIndex: number;
  input: TInput;
  runId: string;
  state: StepState;
  stepId: string;
  stepIndex: number;
  timestamp: string;
};

export type LoopActionRecord = {
  actionId: string;
  input?: unknown;
  name: string;
  runId: string;
  timestamp: string;
};

export type LoopSessionRecord<TInput = unknown> = {
  input: TInput;
  parentCheckpointId?: string;
  parentRunId?: string;
  runId: string;
  status: LoopStatus;
};

export type LoopStore<TInput = unknown> = {
  appendAction?(action: LoopActionRecord): Promise<void> | void;
  appendCheckpoint?(checkpoint: LoopCheckpoint<TInput>): Promise<void> | void;
  appendEvent?(event: EventRecord): Promise<void> | void;
  getSession?(runId: string): Promise<LoopSessionRecord<TInput> | undefined> | LoopSessionRecord<TInput> | undefined;
  listActions?(runId: string): Promise<LoopActionRecord[]> | LoopActionRecord[];
  listCheckpoints?(runId: string): Promise<Array<LoopCheckpoint<TInput>>> | Array<LoopCheckpoint<TInput>>;
  listEvents?(runId: string): Promise<EventRecord[]> | EventRecord[];
  saveSession?(session: LoopSessionRecord<TInput>): Promise<void> | void;
};

export type LoopConfig<TUse, TInput> = {
  description?: string;
  end?: LoopBoundary;
  id: string;
  label?: string;
  questionResolvers?: QuestionResolverRegistry;
  steps: StepDefinition<TUse, TInput>[];
  trigger?: LoopBoundary;
  use?: TUse;
};

export type LoopBoundary = {
  boundary: "end" | "trigger";
  config?: Record<string, unknown>;
  description?: string;
  id: string;
  input?: StepContractSourceMap;
  label?: string;
  output?: StepContractSourceMap;
  type?: string;
};

export type LoopGraphBoundary = {
  boundary: "end" | "trigger";
  config?: Record<string, unknown>;
  description?: string;
  id: string;
  input?: LoopGraphPort[];
  label: string;
  output?: LoopGraphPort[];
  type?: string;
};

export type LoopGraphNode = {
  catalogItemId?: string;
  catalog?: LoopGraphCatalogItem;
  childNodes?: LoopGraphChildNode[];
  description?: string;
  id: string;
  input?: LoopGraphPort[];
  kind: string;
  label: string;
  maxRetries: number;
  models?: LoopGraphModelOperation[];
  output?: LoopGraphPort[];
};

export type LoopGraphCatalogItem = {
  capabilities?: string[];
  description?: string;
  execution?: {
    branches?: Array<{
      childWorkflowDocumentId: string;
      id: string;
      label?: string;
    }>;
    childWorkflowDocumentId?: string;
    itemLabelPath?: string;
    itemSource?: string;
    joinPolicy?: "all" | "any";
    kind?: string;
    label?: string;
    routes?: Array<{
      childWorkflowDocumentId: string;
      id: string;
      label?: string;
    }>;
  };
  id: string;
  implementation?: {
    children?: string[];
    kind?: string;
    source?: string;
    workflowDocumentId?: string;
  };
  intents?: string[];
  kind?: string;
  label: string;
  sideEffects?: string[];
  tags?: string[];
  verbs?: string[];
};

export type LoopGraphChildNode = {
  branch?: {
    id: string;
    label?: string;
  };
  catalog?: LoopGraphCatalogItem;
  catalogItemId?: string;
  description?: string;
  id: string;
  input?: LoopGraphPort[];
  kind?: string;
  label: string;
  loop?: {
    backToNodeId?: string;
    endNodeId: string;
    id: string;
    label?: string;
    role: "body" | "end" | "start";
    startNodeId: string;
  };
  output?: LoopGraphPort[];
  route?: {
    id: string;
    label?: string;
  };
};

export type LoopGraphModelOperation = StepModelOperation;

export type LoopGraphPort = {
  contractId: string;
  jsonSchema?: unknown;
  key: string;
};

export type LoopGraphEdge = {
  from: string;
  id: string;
  kind: "sequence";
  to: string;
};

export type LoopGraphProjection = {
  description?: string;
  end?: LoopGraphBoundary;
  edges: LoopGraphEdge[];
  id: string;
  label: string;
  nodes: LoopGraphNode[];
  trigger?: LoopGraphBoundary;
};

export type LoopStartOptions = {
  answers?: Record<string, unknown>;
  onEvent?: EventSink;
  questionResolvers?: QuestionResolverRegistry;
  runId?: string;
  store?: LoopStore;
};

export type LoopSessionDurableSnapshot = {
  consumedHookTokens: string[];
  createdStepIds: string[];
  currentStepIndex: number;
  hasStarted: boolean;
  hookAnswers: Record<string, unknown>;
  nextEventIndex: number;
  questionResolutionHistory?: Record<string, QuestionResolutionHistoryItem[]>;
  retryCounts: Record<string, number>;
  stepRunCounts: Record<string, number>;
  version: 1;
};

export type LoopHydrationSnapshot<TInput = unknown> = {
  answers?: Record<string, unknown>;
  checkpoints?: Array<LoopCheckpoint<unknown>>;
  durable?: LoopSessionDurableSnapshot;
  events?: EventRecord[];
  input: TInput;
  parentCheckpointId?: string;
  parentRunId?: string;
  pendingHooks?: HookRequest[];
  pendingQuestions?: Question[];
  runId: string;
  state?: unknown;
  status: LoopStatus | string;
};

export type LoopHydrateOptions = Omit<LoopStartOptions, "answers" | "runId">;

export type LoopRerunOptions<TInput = unknown> = LoopStartOptions & {
  checkpointId: string;
  input?: TInput;
  state?: StepState;
};

export type IntentStepOptions = {
  domain: Domain;
} & StepOptions;

export type IntentLoopStage =
  | "intent_resolution"
  | "question_resolution"
  | "candidate_construction"
  | "candidate_evaluation"
  | "next_action";

export type IntentLoopDecision = {
  action: CandidateNextAction;
  message?: string;
  score?: number;
  stage: IntentLoopStage;
};
