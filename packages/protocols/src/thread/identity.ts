export type DromioJsonPrimitive = string | number | boolean | null;

export type DromioJsonValue =
  | DromioJsonPrimitive
  | DromioJsonObject
  | readonly DromioJsonValue[];

export interface DromioJsonObject {
  readonly [key: string]: DromioJsonValue;
}

export const dromioActorTypes = ["user", "service", "system", "share_link"] as const;
export type DromioActorType = (typeof dromioActorTypes)[number];

export interface DromioActorReference {
  readonly type: DromioActorType;
  readonly id: string;
}

export interface DromioActorContextV1 {
  readonly schemaVersion: "dromio.actor-context.v1";
  readonly subject: DromioActorReference;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly sessionId?: string;
  readonly roles: readonly string[];
  readonly groupIds: readonly string[];
}

export const dromioPrincipalTypes = [
  "user",
  "group",
  "service",
  "tenant",
  "share_link",
] as const;

export type DromioPrincipalType = (typeof dromioPrincipalTypes)[number];

export interface DromioPrincipalReference {
  readonly type: DromioPrincipalType;
  readonly id: string;
}

export interface DromioResourceReference {
  readonly type: string;
  readonly id: string;
}

export interface DromioResourceProvenance {
  readonly source: "chat" | "api" | "schedule" | "webhook" | "workflow" | "migration";
  readonly actor: DromioActorReference;
  readonly applicationId: string;
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly commandId?: string;
  readonly eventId?: string;
  readonly applicationReleaseId?: string;
  readonly workflowId?: string;
  readonly triggerId?: string;
  readonly threadId?: string;
  readonly turnId?: string;
  readonly itemId?: string;
  readonly runId?: string;
  readonly attemptId?: string;
  readonly contextSnapshotId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly toolId?: string;
  readonly policyVersion?: string;
}
