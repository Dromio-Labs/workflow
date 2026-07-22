export const dromioProtocolSchemaNames = [
  "runtime-event",
  "runtime-event-envelope",
  "approval-requested",
  "approval-resolved",
  "question-requested",
  "question-answered",
  "artifact-proposed",
  "artifact-decision",
  "workflow-run-event",
  "room-command",
  "room-event",
  "room-snapshot",
  "transport-envelope",
  "actor-context",
  "api-error",
  "thread",
  "thread-item",
  "turn",
  "interaction-request",
  "file",
  "context-snapshot",
  "context-summary",
  "thread-access-grant",
  "user-thread-state",
  "thread-export",
  "usage-record",
  "audit-record",
  "thread-command",
  "thread-event",
  "execution-command",
  "trigger-occurrence",
  "command-receipt"
  ,"thread-share-link"
  ,"thread-draft"
  ,"retention-policy"
  ,"legal-hold"
  ,"purge-receipt"
  ,"thread-authority-receipt"
  ,"message-revision"
  ,"user-event"
  ,"thread-api-capabilities"
  ,"file-upload"
  ,"file-reference"
  ,"backup-purge-ledger-entry"
  ,"restore-purge-receipt"
  ,"resource-provenance"
  ,"browser-operation"
  ,"browser-result"
  ,"browser-error"
  ,"browser-event"
  ,"browser-policy"
  ,"browser-feature-set"
] as const;

export type DromioProtocolSchemaName = (typeof dromioProtocolSchemaNames)[number];

export const dromioProtocolSchemaIds = {
  "runtime-event": "https://schemas.dromio.dev/runtime-event/v1.schema.json",
  "runtime-event-envelope": "https://schemas.dromio.dev/runtime-event-envelope/v1.schema.json",
  "approval-requested": "https://schemas.dromio.dev/approval-requested/v1.schema.json",
  "approval-resolved": "https://schemas.dromio.dev/approval-resolved/v1.schema.json",
  "question-requested": "https://schemas.dromio.dev/question-requested/v1.schema.json",
  "question-answered": "https://schemas.dromio.dev/question-answered/v1.schema.json",
  "artifact-proposed": "https://schemas.dromio.dev/artifact-proposed/v1.schema.json",
  "artifact-decision": "https://schemas.dromio.dev/artifact-decision/v1.schema.json",
  "workflow-run-event": "https://schemas.dromio.dev/workflow-run-event/v1.schema.json",
  "room-command": "https://schemas.dromio.dev/room-command/v1.schema.json",
  "room-event": "https://schemas.dromio.dev/room-event/v1.schema.json",
  "room-snapshot": "https://schemas.dromio.dev/room-snapshot/v1.schema.json",
  "transport-envelope": "https://schemas.dromio.dev/transport-envelope/v1.schema.json",
  "actor-context": "https://schemas.dromio.dev/actor-context/v1.schema.json",
  "api-error": "https://schemas.dromio.dev/api-error/v1.schema.json",
  "thread": "https://schemas.dromio.dev/thread/v1.schema.json",
  "thread-item": "https://schemas.dromio.dev/thread-item/v1.schema.json",
  "turn": "https://schemas.dromio.dev/turn/v1.schema.json",
  "interaction-request": "https://schemas.dromio.dev/interaction-request/v1.schema.json",
  "file": "https://schemas.dromio.dev/file/v1.schema.json",
  "context-snapshot": "https://schemas.dromio.dev/context-snapshot/v1.schema.json",
  "context-summary": "https://schemas.dromio.dev/context-summary/v1.schema.json",
  "thread-access-grant": "https://schemas.dromio.dev/thread-access-grant/v1.schema.json",
  "user-thread-state": "https://schemas.dromio.dev/user-thread-state/v1.schema.json",
  "thread-export": "https://schemas.dromio.dev/thread-export/v1.schema.json",
  "usage-record": "https://schemas.dromio.dev/usage-record/v1.schema.json",
  "audit-record": "https://schemas.dromio.dev/audit-record/v1.schema.json",
  "thread-command": "https://schemas.dromio.dev/thread-command/v1.schema.json",
  "thread-event": "https://schemas.dromio.dev/thread-event/v1.schema.json",
  "execution-command": "https://schemas.dromio.dev/execution-command/v1.schema.json",
  "trigger-occurrence": "https://schemas.dromio.dev/trigger-occurrence/v1.schema.json",
  "command-receipt": "https://schemas.dromio.dev/command-receipt/v1.schema.json",
  "thread-share-link": "https://schemas.dromio.dev/thread-share-link/v1.schema.json",
  "thread-draft": "https://schemas.dromio.dev/thread-draft/v1.schema.json",
  "retention-policy": "https://schemas.dromio.dev/retention-policy/v1.schema.json",
  "legal-hold": "https://schemas.dromio.dev/legal-hold/v1.schema.json",
  "purge-receipt": "https://schemas.dromio.dev/purge-receipt/v1.schema.json",
  "thread-authority-receipt": "https://schemas.dromio.dev/thread-authority-receipt/v1.schema.json",
  "message-revision": "https://schemas.dromio.dev/message-revision/v1.schema.json",
  "user-event": "https://schemas.dromio.dev/user-event/v1.schema.json",
  "thread-api-capabilities": "https://schemas.dromio.dev/thread-api-capabilities/v1.schema.json",
  "file-upload": "https://schemas.dromio.dev/file-upload/v1.schema.json",
  "file-reference": "https://schemas.dromio.dev/file-reference/v1.schema.json",
  "backup-purge-ledger-entry": "https://schemas.dromio.dev/backup-purge-ledger-entry/v1.schema.json",
  "restore-purge-receipt": "https://schemas.dromio.dev/restore-purge-receipt/v1.schema.json",
  "resource-provenance": "https://schemas.dromio.dev/resource-provenance/v1.schema.json",
  "browser-operation": "https://schemas.dromio.dev/browser-operation/v1.schema.json",
  "browser-result": "https://schemas.dromio.dev/browser-result/v1.schema.json",
  "browser-error": "https://schemas.dromio.dev/browser-error/v1.schema.json",
  "browser-event": "https://schemas.dromio.dev/browser-event/v1.schema.json",
  "browser-policy": "https://schemas.dromio.dev/browser-policy/v1.schema.json",
  "browser-feature-set": "https://schemas.dromio.dev/browser-feature-set/v1.schema.json"
} as const satisfies Record<DromioProtocolSchemaName, string>;

export const roomCommandNames = [
  "room.create",
  "room.join",
  "room.leave",
  "room.appendMessage",
  "room.inviteAgent",
  "room.raiseHand",
  "room.resolveHand",
  "room.proposeArtifact",
  "room.decideArtifact",
  "room.recordDecision",
  "room.linkWorkflowRun",
  "room.applyWorkflowEvent"
] as const;

export type RoomCommandName = (typeof roomCommandNames)[number];

export const dromioRoomCommandSchemaVersion = "dromio.room-command.v1" as const;

export const roomEventNames = [
  "room.created",
  "room.started",
  "room.ended",
  "participant.joined",
  "participant.left",
  "message.appended",
  "approval.requested",
  "approval.resolved",
  "handRaise.opened",
  "handRaise.resolved",
  "artifact.proposed",
  "artifact.approved",
  "artifact.rejected",
  "decision.recorded",
  "workflow.run.linked",
  "workflow.run.updated",
  "workflow.event"
] as const;

export type RoomEventName = (typeof roomEventNames)[number];

export const dromioRoomEventSchemaVersion = "dromio.room-event.v1" as const;

export const dromioRoomSnapshotSchemaVersion = "dromio.room-snapshot.v1" as const;

export const dromioTransportBindingNames = [
  "rest-sse",
  "json-rpc-stdio",
  "json-rpc-websocket",
  "mcp-tools",
  "in-process"
] as const;

export type DromioTransportBindingName = (typeof dromioTransportBindingNames)[number];

export const dromioRuntimeEventSchemaVersion = "dromio.runtime-event.v1" as const;

export const dromioRuntimeEventTypeNames = [
  "approval.requested",
  "approval.resolved",
  "artifact.proposed",
  "artifact.approved",
  "artifact.rejected",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "question.requested",
  "question.answered",
  "workflow.event",
  "workflow.run.started",
  "workflow.run.progress",
  "workflow.run.completed",
  "workflow.run.failed"
] as const;

export type DromioRuntimeEventTypeName = (typeof dromioRuntimeEventTypeNames)[number];

export interface DromioRuntimeEventV1 {
  readonly schemaVersion: typeof dromioRuntimeEventSchemaVersion;
  readonly eventId: string;
  readonly type: DromioRuntimeEventTypeName;
  readonly timestamp: string;
  readonly workflowId?: string;
  readonly runId?: string;
  readonly stepId?: string;
  readonly correlationId?: string;
  readonly actorId?: string;
  readonly payload: Record<string, unknown>;
}

export const dromioRuntimeEventEnvelopeSchemaVersion =
  "dromio.runtime-event-envelope.v1" as const;

export interface DromioRuntimeEventEnvelopeV1 {
  readonly schemaVersion: typeof dromioRuntimeEventEnvelopeSchemaVersion;
  readonly id: string;
  readonly source: string;
  readonly subject: string;
  readonly type: string;
  readonly time: string;
  readonly traceId?: string;
  readonly correlationId?: string;
  readonly data: Record<string, unknown>;
}

export const dromioTransportEnvelopeSchemaVersion = "dromio.transport-envelope.v1" as const;

export const dromioTransportEnvelopeDirectionNames = [
  "client-to-host",
  "host-to-client"
] as const;

export type DromioTransportEnvelopeDirectionName =
  (typeof dromioTransportEnvelopeDirectionNames)[number];

export const dromioTransportEnvelopeMessageTypeNames = [
  "command",
  "event",
  "result",
  "error",
  "snapshot",
  "heartbeat"
] as const;

export type DromioTransportEnvelopeMessageTypeName =
  (typeof dromioTransportEnvelopeMessageTypeNames)[number];

export interface DromioTransportEnvelopeV1 {
  readonly schemaVersion: typeof dromioTransportEnvelopeSchemaVersion;
  readonly id: string;
  readonly transport: DromioTransportBindingName;
  readonly direction: DromioTransportEnvelopeDirectionName;
  readonly messageType: DromioTransportEnvelopeMessageTypeName;
  readonly time: string;
  readonly payload: Record<string, unknown>;
}

export interface DromioSchemaRegistryEntry {
  readonly name: DromioProtocolSchemaName;
  readonly version: "v1";
  readonly path: `${DromioProtocolSchemaName}/v1.schema.json`;
  readonly id: (typeof dromioProtocolSchemaIds)[DromioProtocolSchemaName];
  readonly description: string;
}

export * from "./thread/identity.js";
export * from "./thread/resources.js";
export * from "./thread/execution.js";
export * from "./thread/governance.js";
export * from "./thread/events.js";
export * from "./thread/capabilities.js";
export * from "./browser.js";
export * from "./browser-operations.js";
export * from "./browser-operation-schemas.js";
