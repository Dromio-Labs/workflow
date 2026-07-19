import type {
  EventPayload,
  EventRecord,
  LoopCheckpoint,
  LoopStartOptions,
  LoopStatus,
  HookRequest,
} from "../loop/index.js";

export type RuntimeStatus = LoopStatus;

export type RuntimeAuthzDecision = {
  ok: boolean;
  reason?: string;
};

export type RuntimeTarget = {
  id?: string;
  kind: "workflow" | "session" | "hook" | "action";
  workflowKey?: string;
};

export type RuntimeAuthzInput = {
  actor?: unknown;
  operation: string;
  target?: RuntimeTarget;
};

export type RuntimeAuthz = (
  input: RuntimeAuthzInput,
) => Promise<RuntimeAuthzDecision> | RuntimeAuthzDecision;

export type RuntimeStartOptions = {
  actor?: unknown;
  answers?: Record<string, unknown>;
  runId?: string;
};

export type RuntimeSessionSnapshot = {
  checkpoints: Array<LoopCheckpoint<unknown>>;
  events: EventRecord[];
  input: unknown;
  output?: unknown;
  parentCheckpointId?: string;
  parentRunId?: string;
  pendingHooks: HookRequest[];
  pendingQuestions: unknown[];
  result?: unknown;
  runId: string;
  state: Record<string, unknown>;
  status: RuntimeStatus;
  workflowKey: string;
};

export type RuntimeWorkflowDescriptor = {
  description?: string;
  key: string;
  title?: string;
};

export type RuntimeWorkflowInputDescriptor = {
  description?: string;
  key?: string;
  title?: string;
};

export type RuntimeWorkflowStartResult = {
  session: RuntimeSessionSnapshot;
  control?: RuntimeSessionControl;
};

export type RuntimeWorkflow<TInput = unknown> = RuntimeWorkflowInputDescriptor & {
  start(input: TInput, options?: RuntimeStartOptions & { emit: (event: EventPayload) => void }): Promise<RuntimeWorkflowStartResult> | RuntimeWorkflowStartResult;
};

export type RuntimeStartableSession = {
  answer?(input: { questionId: string; value: unknown }): Promise<unknown> | unknown;
  cancel?(input?: { reason?: string }): Promise<unknown> | unknown;
  checkpoints: Array<LoopCheckpoint<unknown>>;
  events: EventRecord[];
  input?: unknown;
  parentCheckpointId?: string;
  parentRunId?: string;
  pendingHooks: HookRequest[];
  pendingQuestions: unknown[];
  resume(): Promise<unknown> | unknown;
  resumeHook?(input: { token: string; value: unknown }): Promise<unknown> | unknown;
  rerunFromCheckpoint?(input: { checkpointId: string; input?: unknown; state?: Record<string, unknown> } & LoopStartOptions): Promise<RuntimeStartableSession> | RuntimeStartableSession;
  runId: string;
  state: Record<string, unknown>;
  status: RuntimeStatus;
};

export type RuntimeStartable<TInput = unknown> = RuntimeWorkflowInputDescriptor & {
  start(input: TInput, options?: LoopStartOptions): Promise<RuntimeStartableSession> | RuntimeStartableSession;
};

export type RuntimeSessionControl = {
  answer?(input: { questionId: string; value: unknown }): Promise<RuntimeSessionSnapshot> | RuntimeSessionSnapshot;
  cancel?(input?: { reason?: string }): Promise<RuntimeSessionSnapshot> | RuntimeSessionSnapshot;
  pause?(input?: { reason?: string }): Promise<RuntimeSessionSnapshot> | RuntimeSessionSnapshot;
  resume?(): Promise<RuntimeSessionSnapshot> | RuntimeSessionSnapshot;
  resumeHook?(input: { token: string; value: unknown }): Promise<RuntimeSessionSnapshot> | RuntimeSessionSnapshot;
  rerunFromCheckpoint?(input: { checkpointId: string; input?: unknown; state?: Record<string, unknown> }): Promise<RuntimeSessionSnapshot> | RuntimeSessionSnapshot;
};

export type RuntimeActionAvailability = {
  reason?: string;
  status: "available" | "unavailable";
};

export type RuntimeActionContext = {
  actor?: unknown;
  input?: unknown;
  runtime: IntentRuntime;
  session: RuntimeSessionSnapshot;
};

export type RuntimeActionResult = {
  actionKey: string;
  output?: unknown;
  session?: RuntimeSessionSnapshot;
  status: "accepted" | "rejected";
  error?: {
    code: string;
    message: string;
  };
};

export type RuntimeAction = {
  available?(context: RuntimeActionContext): Promise<RuntimeActionAvailability> | RuntimeActionAvailability;
  description?: string;
  key: string;
  run(context: RuntimeActionContext): Promise<RuntimeActionResult> | RuntimeActionResult;
  title?: string;
};

export type RuntimeActionDescriptor = {
  description?: string;
  key: string;
  reason?: string;
  status: RuntimeActionAvailability["status"];
  title?: string;
};

export type CreateIntentRuntimeInput = {
  actions?: RuntimeAction[] | Record<string, RuntimeAction>;
  authz?: RuntimeAuthz;
  workflows: RuntimeWorkflow[] | RuntimeStartable[] | Record<string, RuntimeWorkflow | RuntimeStartable>;
};

export type RuntimeEventStreamOptions = {
  fromIndex?: number;
};

export type RuntimeResumeHookInput = {
  actor?: unknown;
  token: string;
  value: unknown;
};

export type RuntimeRerunInput = {
  actor?: unknown;
  checkpointId: string;
  input?: unknown;
  sessionId: string;
  state?: Record<string, unknown>;
};

export type RuntimeApplyActionInput = {
  actionKey: string;
  actor?: unknown;
  input?: unknown;
  sessionId: string;
};

export type IntentRuntime = {
  applyAction(input: RuntimeApplyActionInput): Promise<RuntimeActionResult>;
  cancelSession(sessionId: string, input?: { actor?: unknown; reason?: string }): Promise<RuntimeSessionSnapshot>;
  getSession(sessionId: string, input?: { actor?: unknown }): Promise<RuntimeSessionSnapshot>;
  listActions(sessionId: string, input?: { actor?: unknown }): Promise<RuntimeActionDescriptor[]>;
  listCheckpoints(sessionId: string, input?: { actor?: unknown }): Promise<Array<LoopCheckpoint<unknown>>>;
  listEvents(sessionId: string, input?: { actor?: unknown; fromIndex?: number }): Promise<EventRecord[]>;
  listSessions(input?: { actor?: unknown }): Promise<RuntimeSessionSnapshot[]>;
  listWorkflows(input?: { actor?: unknown }): Promise<RuntimeWorkflowDescriptor[]>;
  pauseSession(sessionId: string, input?: { actor?: unknown; reason?: string }): Promise<RuntimeSessionSnapshot>;
  rerunFromCheckpoint(input: RuntimeRerunInput): Promise<RuntimeSessionSnapshot>;
  resumeHook(input: RuntimeResumeHookInput): Promise<RuntimeSessionSnapshot>;
  resumeSession(sessionId: string, input?: { actor?: unknown }): Promise<RuntimeSessionSnapshot>;
  startWorkflow(workflowKey: string, input: unknown, options?: RuntimeStartOptions): Promise<RuntimeSessionSnapshot>;
  streamEvents(sessionId: string, options?: RuntimeEventStreamOptions & { actor?: unknown }): AsyncIterable<EventRecord>;
};
