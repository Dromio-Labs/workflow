import type { JsonObject, JsonValue } from "../../shared/json.js";

export type AgentRuntimeActor = {
  displayName?: string;
  id: string;
  kind: "agent" | "service" | "user";
};

export type AgentRuntimeMessage = {
  content: string;
  name?: string;
  role: "assistant" | "system" | "tool" | "user";
};

export type AgentRuntimeToolSurfaceRef = {
  grantIds: string[];
  surfaceId: string;
};

export type AgentRuntimeSessionRef = {
  sessionId: string;
  traceId?: string;
};

export type AgentRuntimeToolContextEvent =
  | {
      toolId: string;
      input?: unknown;
      runId?: string;
      timestamp?: string;
      type: "tool.started";
      workflowId?: string;
    }
  | {
      toolId: string;
      output?: unknown;
      runId?: string;
      timestamp?: string;
      type: "tool.completed";
      workflowId?: string;
    }
  | {
      toolId: string;
      error: string;
      runId?: string;
      timestamp?: string;
      type: "tool.failed";
      workflowId?: string;
    };

export type AgentRuntimeWorkflowContextEvent = {
  event: unknown;
  runId?: string;
  timestamp?: string;
  type: "workflow.event";
  workflowId: string;
};

export type AgentRuntimeApprovalContextEvent =
  | {
      toolId?: string;
      requestId: string;
      runId?: string;
      summary: string;
      timestamp?: string;
      type: "approval.requested";
      workflowId?: string;
    }
  | {
      decision: "approve" | "reject";
      note?: string;
      requestId: string;
      runId?: string;
      timestamp?: string;
      type: "approval.resolved";
      workflowId?: string;
    };

export type AgentRuntimeRunSuspendedInteraction = {
  id: string;
  kind: string;
  summary: string;
  title?: string;
  token?: string;
};

export type AgentRuntimeRunSuspendedContextEvent = {
  interactions: AgentRuntimeRunSuspendedInteraction[];
  runId: string;
  timestamp?: string;
  type: "run.suspended";
  workflowId: string;
};

export type AgentRuntimeContextEvent =
  | AgentRuntimeApprovalContextEvent
  | AgentRuntimeRunSuspendedContextEvent
  | AgentRuntimeToolContextEvent
  | AgentRuntimeWorkflowContextEvent;

export type AgentRuntimeContext<TState extends JsonObject = JsonObject> = {
  emit?: (event: AgentRuntimeContextEvent) => Promise<void> | void;
  session?: AgentRuntimeSessionRef;
  state: TState;
  threadId?: string;
};

export type AgentRuntimeInvocation<TContext extends JsonObject = JsonObject> = {
  actor: AgentRuntimeActor;
  agentId: string;
  context: TContext;
  instructions?: string;
  invocationId: string;
  messages: AgentRuntimeMessage[];
  model?: string;
  threadId?: string;
  toolSurface?: AgentRuntimeToolSurfaceRef;
  traceId?: string;
};

export type AgentRuntimeAdapterFeatures = {
  durableSessions: boolean;
  streaming: boolean;
  toolSurfaceRequired: boolean;
};

export type AgentRuntimeEvent<TPayload extends JsonObject = JsonObject> = {
  eventId: string;
  kind: string;
  occurredAt: string;
  payload: TPayload;
};

export type AgentRuntimeResult<TOutput extends JsonValue = JsonValue> = {
  error?: {
    code: string;
    message: string;
  };
  events?: AgentRuntimeEvent[];
  output?: TOutput;
  status: "auth_failed" | "completed" | "failed" | "timeout" | "unavailable";
};

export type AgentRuntimeHealth = {
  checkedAt: string;
  message?: string;
  status: "healthy" | "unhealthy" | "unavailable";
};

export type AgentRuntimeAdapter<
  TInvocation = AgentRuntimeInvocation,
  TResult = AgentRuntimeResult,
> = {
  features: AgentRuntimeAdapterFeatures;
  id: string;
  invoke(input: TInvocation): Promise<TResult> | TResult;
  kind: string;
  label: string;
  probe?(): Promise<AgentRuntimeHealth> | AgentRuntimeHealth;
  cancel?(session: AgentRuntimeSessionRef): Promise<AgentRuntimeResult> | AgentRuntimeResult;
};

export type AgentRuntimeRouter<
  TInvocation = AgentRuntimeInvocation,
  TResult = AgentRuntimeResult,
> = {
  invoke(input: TInvocation): Promise<TResult> | TResult;
  listAdapters(): AgentRuntimeAdapter<TInvocation, TResult>[];
  selectAdapter(input: TInvocation): AgentRuntimeAdapter<TInvocation, TResult>;
};
