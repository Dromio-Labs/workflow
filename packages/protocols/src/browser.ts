export const dromioBrowserProtocolVersion = "dromio.browser.v1" as const;

export type DromioBrowserJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly DromioBrowserJsonValue[]
  | { readonly [key: string]: DromioBrowserJsonValue };

export interface DromioBrowserScopeV1 {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly userId: string;
  readonly threadId: string;
}

export const dromioBrowserEffectClasses = [
  "read", "interaction", "mutation", "lifecycle", "artifact", "diagnostic",
] as const;
export type DromioBrowserEffectClass = (typeof dromioBrowserEffectClasses)[number];

export const dromioBrowserPermissionClasses = [
  "browser.read", "browser.interact", "browser.state", "browser.files",
  "browser.network", "browser.diagnostics", "browser.sessions", "browser.host",
] as const;
export type DromioBrowserPermissionClass = (typeof dromioBrowserPermissionClasses)[number];

export const dromioBrowserApprovalModes = [
  "automatic", "approval-required", "disabled",
] as const;
export type DromioBrowserApprovalMode = (typeof dromioBrowserApprovalModes)[number];

export const dromioBrowserRecoveryPolicies = [
  "safe-retry", "observe-before-retry", "never-retry",
] as const;
export type DromioBrowserRecoveryPolicy = (typeof dromioBrowserRecoveryPolicies)[number];

export const dromioBrowserFeatureGroups = [
  "inspect", "interaction", "tabs", "files", "state", "diagnostics",
  "network", "emulation", "recording", "remote",
] as const;
export type DromioBrowserFeatureGroup = (typeof dromioBrowserFeatureGroups)[number];

export const dromioBrowserBackendNames = ["managed", "remote"] as const;
export type DromioBrowserBackendName = (typeof dromioBrowserBackendNames)[number];

export interface DromioBrowserArtifactReferenceV1 {
  readonly schemaVersion: "dromio.browser-artifact.v1";
  readonly fileId: string;
  readonly digest: `sha256:${string}`;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sourceOperation: string;
  readonly retention: "ephemeral" | "thread" | "application";
  readonly availability: "pending" | "available" | "unavailable";
  readonly deletion: "active" | "scheduled" | "deleted";
}

export interface DromioBrowserOperationV1 {
  readonly schemaVersion: "dromio.browser-operation.v1";
  readonly requestId: string;
  readonly operationId: `browser.${string}`;
  readonly scope: DromioBrowserScopeV1;
  readonly effectClass: DromioBrowserEffectClass;
  readonly permissionClass: DromioBrowserPermissionClass;
  readonly approval: DromioBrowserApprovalMode;
  readonly recovery: DromioBrowserRecoveryPolicy;
  readonly input: Readonly<Record<string, DromioBrowserJsonValue>>;
}

export interface DromioBrowserObservationV1 {
  readonly observationId: string;
  readonly tabId: string;
  readonly frameId: string;
  readonly url: string;
  readonly title: string | null;
  readonly revision: number;
}

export interface DromioBrowserResultV1 {
  readonly schemaVersion: "dromio.browser-result.v1";
  readonly requestId: string;
  readonly operationId: `browser.${string}`;
  readonly status: "completed" | "accepted";
  readonly output: DromioBrowserJsonValue;
  readonly observation?: DromioBrowserObservationV1;
  readonly artifacts: readonly DromioBrowserArtifactReferenceV1[];
}

export const dromioBrowserErrorCodes = [
  "aborted", "approval-required", "connect-failed", "disconnected",
  "invalid-input", "not-found", "permission-denied", "policy-denied",
  "post-dispatch-uncertain", "protocol-failed", "quota-exceeded",
  "scope-denied", "stale-observation", "timeout", "unsupported",
] as const;
export type DromioBrowserErrorCode = (typeof dromioBrowserErrorCodes)[number];

export interface DromioBrowserErrorV1 {
  readonly schemaVersion: "dromio.browser-error.v1";
  readonly requestId: string;
  readonly operationId: `browser.${string}`;
  readonly code: DromioBrowserErrorCode;
  readonly message: string;
  readonly phase: "pre-dispatch" | "post-dispatch-uncertain";
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, DromioBrowserJsonValue>>;
}

export const dromioBrowserEventTypes = [
  "operation.started", "operation.completed", "operation.failed",
  "observation.invalidated", "tab.opened", "tab.closed", "artifact.available",
  "download.available", "console.recorded", "network.recorded",
  "session.disconnected", "session.restored",
] as const;
export type DromioBrowserEventType = (typeof dromioBrowserEventTypes)[number];

export interface DromioBrowserEventV1 {
  readonly schemaVersion: "dromio.browser-event.v1";
  readonly eventId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type: DromioBrowserEventType;
  readonly scope: DromioBrowserScopeV1;
  readonly requestId?: string;
  readonly operationId?: `browser.${string}`;
  readonly payload: Readonly<Record<string, DromioBrowserJsonValue>>;
  readonly nextCursor?: string;
}

export interface DromioBrowserOperationPolicyV1 {
  readonly operationId: `browser.${string}`;
  readonly mode: DromioBrowserApprovalMode;
}

export interface DromioBrowserPolicyV1 {
  readonly schemaVersion: "dromio.browser-policy.v1";
  readonly enabledFeatures: readonly DromioBrowserFeatureGroup[];
  readonly defaultMode: DromioBrowserApprovalMode;
  readonly operations: readonly DromioBrowserOperationPolicyV1[];
  readonly allowedOrigins?: readonly string[];
  readonly limits: {
    readonly maxSessions: number;
    readonly maxTabsPerSession: number;
    readonly maxArtifactBytes: number;
    readonly maxEventRecords: number;
  };
}

export interface DromioBrowserFeatureSupportV1 {
  readonly feature: DromioBrowserFeatureGroup;
  readonly status: "supported" | "unsupported" | "disabled";
  readonly reason?: string;
}

export interface DromioBrowserFeatureSetV1 {
  readonly schemaVersion: "dromio.browser-feature-set.v1";
  readonly backend: DromioBrowserBackendName;
  readonly features: readonly DromioBrowserFeatureSupportV1[];
  readonly operationIds: readonly `browser.${string}`[];
}
