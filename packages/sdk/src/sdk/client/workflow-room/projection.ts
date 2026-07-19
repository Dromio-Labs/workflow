import type {
  EventRecord,
  HookRequest,
} from "../../core/index.js";
import type {
  RuntimeSessionSnapshot,
} from "../../core/runtime/index.js";
import type {
  WorkflowHookRequest,
  WorkflowRunEvent,
  WorkflowRunSnapshot,
} from "@dromio/workflow-room-protocol";
import type { WorkflowRenderModel as ProtocolWorkflowRenderModel } from "@dromio/workflow-canvas-protocol";
import type {
  WorkflowRenderModel,
} from "../workflow-render/types.js";
import {
  toWorkflowRoomJsonObject,
  toWorkflowRoomJsonValue,
} from "./json.js";

export function projectRuntimeSessionToWorkflowRoomRun(
  session: RuntimeSessionSnapshot,
): WorkflowRunSnapshot {
  return {
    checkpoints: session.checkpoints.map(toWorkflowRoomJsonValue),
    events: session.events.map(projectEventRecord),
    input: toWorkflowRoomJsonValue(session.input),
    ...(session.output !== undefined ? { output: toWorkflowRoomJsonValue(session.output) } : {}),
    pendingHooks: session.pendingHooks.map(projectHookRequest),
    pendingQuestions: session.pendingQuestions.map(toWorkflowRoomJsonValue),
    ...(session.result !== undefined ? { result: toWorkflowRoomJsonValue(session.result) } : {}),
    runId: session.runId,
    state: toWorkflowRoomJsonObject(session.state),
    status: session.status,
    workflowKey: session.workflowKey,
  };
}

export function projectWorkflowRenderModelToWorkflowRoom(
  model: WorkflowRenderModel,
): ProtocolWorkflowRenderModel {
  return {
    ...(model.description ? { description: model.description } : {}),
    edges: model.edges.map((edge) => ({
      id: edge.id,
      ...(edge.label ? { label: edge.label } : {}),
      metadata: toWorkflowRoomJsonObject(edge.metadata),
      semantic: edge.semantic,
      source: edge.source,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      target: edge.target,
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    })),
    id: model.id,
    label: model.label,
    loops: model.loops.map((loop) => ({
      ...(loop.backTo ? { backTo: loop.backTo } : {}),
      end: loop.end,
      id: loop.id,
      ...(loop.label ? { label: loop.label } : {}),
      start: loop.start,
    })),
    nodes: model.nodes.map((node) => ({
      ...(node.catalogItemId ? { catalogItemId: node.catalogItemId } : {}),
      ...(node.childWorkflow
        ? {
            childWorkflow: {
              ...(node.childWorkflow.description ? { description: node.childWorkflow.description } : {}),
              ...(node.childWorkflow.execution
                ? {
                    execution: {
                      ...(node.childWorkflow.execution.itemLabelPath ? { itemLabelPath: node.childWorkflow.execution.itemLabelPath } : {}),
                      ...(node.childWorkflow.execution.itemSource ? { itemSource: node.childWorkflow.execution.itemSource } : {}),
                      ...(node.childWorkflow.execution.joinPolicy ? { joinPolicy: node.childWorkflow.execution.joinPolicy } : {}),
                      ...(node.childWorkflow.execution.kind ? { kind: node.childWorkflow.execution.kind } : {}),
                      ...(node.childWorkflow.execution.label ? { label: node.childWorkflow.execution.label } : {}),
                    },
                  }
                : {}),
              id: node.childWorkflow.id,
              label: node.childWorkflow.label,
              model: projectWorkflowRenderModelToWorkflowRoom(node.childWorkflow.model),
            },
          }
        : {}),
      ...(node.childWorkflowId ? { childWorkflowId: node.childWorkflowId } : {}),
      ...(node.description ? { description: node.description } : {}),
      id: node.id,
      kind: node.kind,
      label: node.label,
      metadata: toWorkflowRoomJsonObject(node.metadata),
      ...(node.parentId ? { parentId: node.parentId } : {}),
      ports: node.ports.map((port) => ({
        id: port.id,
        ...(port.key ? { key: port.key } : {}),
        ...(port.label ? { label: port.label } : {}),
        type: port.type,
      })),
      semantic: node.semantic,
      ...(node.status ? { status: node.status } : {}),
    })),
    readOnly: model.readOnly,
    ...(model.selectedNodeId ? { selectedNodeId: model.selectedNodeId } : {}),
    warnings: [...model.warnings],
  };
}

export function projectEventRecord(event: EventRecord): WorkflowRunEvent {
  return {
    ...(event.detail !== undefined ? { detail: toWorkflowRoomJsonValue(event.detail) } : {}),
    index: event.index,
    message: event.message,
    runId: event.runId,
    ...(event.stepId ? { stepId: event.stepId } : {}),
    timestamp: event.timestamp,
    ...(event.trace ? { trace: toWorkflowRoomJsonObject(event.trace) } : {}),
    type: event.type,
  };
}

export function projectHookRequest(
  hook: HookRequest | WorkflowHookRequest,
): WorkflowHookRequest {
  return {
    ...(hook.correlationId ? { correlationId: hook.correlationId } : {}),
    ...(hook.expiresAt ? { expiresAt: hook.expiresAt } : {}),
    id: hook.id,
    input: toWorkflowRoomJsonValue(hook.input),
    ...(hook.kind ? { kind: hook.kind } : {}),
    ...(hook.render ? { render: hook.render } : {}),
    ...(hook.schema ? { schema: toWorkflowRoomJsonObject(hook.schema) } : {}),
    stepId: hook.stepId,
    ...(hook.title ? { title: hook.title } : {}),
    token: hook.token,
  };
}
