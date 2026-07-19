import type { JsonObject, JsonValue } from "../../shared/json.js";

export type ToolSurfaceActor = {
  displayName?: string;
  id: string;
  kind: "agent" | "service" | "user";
};

export type ToolGrantRef = {
  grantId: string;
  scope: string;
};

export type ToolGrant = ToolGrantRef;

export type ToolApprovalRef = {
  approvalId: string;
  approvedBy: ToolSurfaceActor;
  approvedAt: string;
};

export type ApprovalRequest<TInput extends JsonObject = JsonObject> = {
  actor: ToolSurfaceActor;
  input: TInput;
  reason?: string;
  requestedAt: string;
  toolName: string;
  traceId?: string;
};

export type ToolSurfaceDecision = {
  reason?: string;
  status: "allowed" | "denied" | "needs_approval";
};

export type ToolSurfaceInvocation<TInput extends JsonObject = JsonObject> = {
  actor: ToolSurfaceActor;
  approval?: ToolApprovalRef;
  grants: ToolGrantRef[];
  input: TInput;
  invocationId: string;
  toolName: string;
  traceId?: string;
};

export type ToolCallRequest<TInput extends JsonObject = JsonObject> =
  ToolSurfaceInvocation<TInput>;

export type ToolSurfaceResult<TOutput extends JsonValue = JsonValue> = {
  auditId?: string;
  error?: {
    code: string;
    message: string;
  };
  output?: TOutput;
  status: "completed" | "denied" | "failed" | "needs_approval";
};

export type ToolCallResult<TOutput extends JsonValue = JsonValue> =
  ToolSurfaceResult<TOutput>;

export type ToolSurfaceAuditRecord = {
  actor: ToolSurfaceActor;
  auditId: string;
  decision: ToolSurfaceDecision;
  invocationId: string;
  recordedAt: string;
  toolName: string;
};

export type ToolSurfaceAdapter<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonValue = JsonValue,
> = {
  audit(record: ToolSurfaceAuditRecord): Promise<void> | void;
  authorize(input: ToolSurfaceInvocation<TInput>): Promise<ToolSurfaceDecision> | ToolSurfaceDecision;
  id: string;
  invoke(input: ToolSurfaceInvocation<TInput>): Promise<ToolSurfaceResult<TOutput>> | ToolSurfaceResult<TOutput>;
  label: string;
};
