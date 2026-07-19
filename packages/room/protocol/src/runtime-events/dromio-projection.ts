import {
  dromioProtocolSchemaIds,
  dromioRoomEventSchemaVersion,
  roomEventNames,
  type RoomEventName,
} from "@dromio/protocols";
import type {
  JsonObject,
} from "../json.js";
import {
  runtimeEventId,
  eventTimestamp,
} from "./metadata.js";
import {
  workflowRoomRuntimeEventPayload,
} from "./payloads.js";
import type {
  WorkflowRoomRuntimeEvent,
  WorkflowRoomRuntimeProjectionOptions,
} from "./types.js";

export const dromioRoomProjectionProtocolSchemas = {
  roomEvent: dromioProtocolSchemaIds["room-event"],
  roomSnapshot: dromioProtocolSchemaIds["room-snapshot"],
  runtimeEvent: dromioProtocolSchemaIds["runtime-event"],
} as const;

export interface DromioProtocolRoomEvent {
  readonly schemaVersion: typeof dromioRoomEventSchemaVersion;
  readonly eventId: string;
  readonly roomId: string;
  readonly type: RoomEventName;
  readonly occurredAt: string;
  readonly payload: JsonObject;
}

export interface DromioProtocolRoomProjectionOptions
  extends WorkflowRoomRuntimeProjectionOptions {
  readonly roomId: string;
}

export function dromioRoomEventFromRuntimeEvent(
  event: WorkflowRoomRuntimeEvent,
  options: DromioProtocolRoomProjectionOptions,
): DromioProtocolRoomEvent {
  return {
    schemaVersion: dromioRoomEventSchemaVersion,
    eventId: options.id ?? runtimeEventId(event, options.idPrefix ?? "runtime"),
    roomId: options.roomId,
    type: canonicalRoomEventTypeFromRuntimeEvent(event),
    occurredAt: eventTimestamp(event) ?? options.now?.() ?? new Date().toISOString(),
    payload: {
      ...workflowRoomRuntimeEventPayload(event, options),
      sourceRuntimeEventType: event.type,
    },
  };
}

export function canonicalRoomEventTypeFromRuntimeEvent(
  event: WorkflowRoomRuntimeEvent,
): RoomEventName {
  const type = roomEventTypeForRuntimeEvent(event);
  return roomEventNames.includes(type) ? type : "workflow.event";
}

function roomEventTypeForRuntimeEvent(
  event: WorkflowRoomRuntimeEvent,
): RoomEventName {
  switch (event.type) {
    case "approval.requested":
      return "approval.requested";
    case "approval.resolved":
      return "approval.resolved";
    case "artifact.created":
      return "artifact.proposed";
    case "workflow.event":
      return "workflow.event";
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      return "workflow.run.updated";
    case "change.recorded":
    case "diagnostic.recorded":
    case "source.recorded":
      return "workflow.event";
    default:
      return "workflow.run.updated";
  }
}
