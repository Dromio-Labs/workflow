import type {
  IntentRuntime,
  RuntimeSessionSnapshot,
} from "../../core/runtime/index.js";
import {
  interactiveWorkflowViewCapabilities,
  readOnlyWorkflowViewCapabilities,
  createWorkflowViewCommandResult,
  type WorkflowResultPresentation,
  type WorkflowRoomAdapter,
  type WorkflowRoomSnapshot,
  type WorkflowViewBridge,
  type WorkflowViewCapabilities,
  type WorkflowViewCommand,
  type WorkflowViewCommandDispatch,
  type WorkflowViewCommandResult,
  type WorkflowViewSnapshot,
  workflowViewCapabilitiesAllowCommand,
  workflowViewCommandCapabilityPath,
  withWorkflowViewValidation,
} from "@dromio/workflow-room-protocol";
import type {
  WorkflowRenderModel,
} from "../workflow-render/types.js";
import {
  projectRuntimeSessionToWorkflowRoomRun,
  projectWorkflowRenderModelToWorkflowRoom,
} from "./projection.js";
import {
  toWorkflowRoomJsonValue,
} from "./json.js";

export type CreateWorkflowViewBridgeInput = {
  actor?: unknown;
  answerQuestion?: (input: {
    questionId: string;
    runId: string;
    value: unknown;
  }) => Promise<RuntimeSessionSnapshot> | RuntimeSessionSnapshot;
  capabilities?: WorkflowViewCapabilities;
  render: WorkflowRenderModel | (() => Promise<WorkflowRenderModel> | WorkflowRenderModel);
  result?: WorkflowResultPresentation | (() => Promise<WorkflowResultPresentation | undefined> | WorkflowResultPresentation | undefined);
  room?: {
    adapter: WorkflowRoomAdapter;
    id: string;
  };
  runtime: IntentRuntime;
  sessionId: string;
};

export function createWorkflowViewBridge(input: CreateWorkflowViewBridgeInput): WorkflowViewBridge {
  let lastCommandResult: WorkflowViewCommandResult | undefined;

  return {
    async dispatch(command) {
      try {
        const dispatch = await dispatchCommand(input, command);
        lastCommandResult = createWorkflowViewCommandResult({
          command,
          dispatch,
        });
      } catch (error) {
        lastCommandResult = createWorkflowViewCommandResult({
          accepted: false,
          command,
          dispatch: { mode: "runtime" },
          error: {
            code: "WORKFLOW_UI_COMMAND_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
      return await snapshot(input, lastCommandResult);
    },
    async snapshot() {
      return await snapshot(input, lastCommandResult);
    },
  };
}

export async function createWorkflowViewSnapshot(
  input: Omit<CreateWorkflowViewBridgeInput, "actor" | "answerQuestion" | "runtime"> & {
    roomSnapshot?: WorkflowRoomSnapshot;
    session: RuntimeSessionSnapshot;
    commandResult?: WorkflowViewCommandResult;
  },
): Promise<WorkflowViewSnapshot> {
  const render = await resolveRequiredValue(input.render);
  const result = await resolveValue(input.result);
  const run = projectRuntimeSessionToWorkflowRoomRun(input.session);
  return withWorkflowViewValidation({
    capabilities: input.capabilities ?? defaultCapabilities(Boolean(input.room)),
    ...(input.commandResult ? { commandResults: [input.commandResult] } : {}),
    generatedAt: new Date().toISOString(),
    pendingHooks: run.pendingHooks.map((hook) => ({
      ...hook,
      input: toWorkflowRoomJsonValue(hook.input),
      runId: input.session.runId,
    })),
    render: projectWorkflowRenderModelToWorkflowRoom(render),
    ...(result ? { result } : {}),
    ...(input.roomSnapshot ? { room: input.roomSnapshot } : {}),
    run,
    ...(render.selectedNodeId ? { selectedNodeId: render.selectedNodeId } : {}),
    version: "workflow-view/v1",
  });
}

async function snapshot(
  input: CreateWorkflowViewBridgeInput,
  commandResult?: WorkflowViewCommandResult,
): Promise<WorkflowViewSnapshot> {
  const [session, roomSnapshot] = await Promise.all([
    input.runtime.getSession(input.sessionId, { actor: input.actor }),
    input.room?.adapter.getSnapshot(input.room.id),
  ]);
  return createWorkflowViewSnapshot({
    capabilities: input.capabilities,
    commandResult,
    render: input.render,
    result: input.result,
    room: input.room,
    roomSnapshot,
    session,
    sessionId: input.sessionId,
  });
}

async function dispatchCommand(
  input: CreateWorkflowViewBridgeInput,
  command: WorkflowViewCommand,
): Promise<WorkflowViewCommandDispatch> {
  assertCommandCapability(input, command);
  switch (command.type) {
    case "workflow.hook.resume":
      await input.runtime.resumeHook({
        actor: input.actor,
        token: command.token,
        value: command.value,
      });
      await appendRoomAudit(input, command, `Resumed workflow hook ${command.token}.`);
      return runtimeDispatch(command.runId);
    case "workflow.question.answer":
      if (!input.answerQuestion) {
        throw new Error("This workflow view bridge does not support question answering.");
      }
      await input.answerQuestion({
        questionId: command.questionId,
        runId: command.runId,
        value: command.value,
      });
      await appendRoomAudit(input, command, `Answered workflow question ${command.questionId}.`);
      return runtimeDispatch(command.runId);
    case "workflow.action.apply":
      await input.runtime.applyAction({
        actionKey: command.actionKey,
        actor: input.actor,
        input: command.input,
        sessionId: command.runId,
      });
      await appendRoomAudit(input, command, `Applied workflow action ${command.actionKey}.`);
      return runtimeDispatch(command.runId);
    case "workflow.session.pause":
      await input.runtime.pauseSession(command.runId, {
        actor: input.actor,
        reason: command.reason,
      });
      await appendRoomAudit(input, command, `Paused workflow session ${command.runId}.`);
      return runtimeDispatch(command.runId);
    case "workflow.checkpoint.rerun":
      await input.runtime.rerunFromCheckpoint({
        actor: input.actor,
        checkpointId: command.checkpointId,
        input: command.input,
        sessionId: command.runId,
        state: command.state,
      });
      await appendRoomAudit(input, command, `Reran workflow session ${command.runId} from checkpoint ${command.checkpointId}.`);
      return runtimeDispatch(command.runId);
    case "room.appendMessage":
      await requireRoom(input).appendMessage({
        content: command.content,
        metadata: command.metadata,
        roomId: command.roomId,
      });
      return roomDispatch(command.roomId);
    case "room.recordDecision":
      await requireRoom(input).recordDecision({
        content: command.content,
        messageId: command.messageId,
        roomId: command.roomId,
        title: command.title,
      });
      return roomDispatch(command.roomId);
    case "room.resolveHand":
      await requireRoom(input).resolveHandRaise({
        handRaiseId: command.handRaiseId,
        resolvedByMessageId: command.resolvedByMessageId,
        roomId: command.roomId,
        status: command.status,
      });
      return roomDispatch(command.roomId);
  }
  throw new Error(`Unsupported workflow view command: ${(command as { type?: string }).type ?? "unknown"}.`);
}

function assertCommandCapability(
  input: CreateWorkflowViewBridgeInput,
  command: WorkflowViewCommand,
) {
  const capabilities = input.capabilities ?? defaultCapabilities(Boolean(input.room));
  if (workflowViewCapabilitiesAllowCommand(capabilities, command)) return;
  const capability = workflowViewCommandCapabilityPath(command);
  throw new Error(`Workflow View command ${command.type} requires disabled capability ${capability}.`);
}

function runtimeDispatch(targetId: string): WorkflowViewCommandDispatch {
  return {
    mode: "runtime",
    runtimeResumed: true,
    status: "dispatched",
    targetId,
  };
}

function roomDispatch(targetId: string): WorkflowViewCommandDispatch {
  return {
    mode: "room",
    runtimeResumed: false,
    status: "dispatched",
    targetId,
  };
}

async function appendRoomAudit(
  input: CreateWorkflowViewBridgeInput,
  command: WorkflowViewCommand,
  content: string,
): Promise<void> {
  if (!input.room) return;
  await input.room.adapter.appendMessage({
    content,
    metadata: {
      commandType: command.type,
      source: "workflow-view-bridge",
    },
    role: "user",
    roomId: input.room.id,
  });
}

function requireRoom(input: CreateWorkflowViewBridgeInput): WorkflowRoomAdapter {
  if (!input.room) throw new Error("This workflow view bridge does not have a room adapter.");
  return input.room.adapter;
}

function defaultCapabilities(hasRoom: boolean): WorkflowViewCapabilities {
  return hasRoom
    ? interactiveWorkflowViewCapabilities
    : {
        ...interactiveWorkflowViewCapabilities,
        room: readOnlyWorkflowViewCapabilities.room,
      };
}

async function resolveValue<T>(value: T | (() => Promise<T> | T) | undefined): Promise<T | undefined> {
  return typeof value === "function" ? await (value as () => Promise<T> | T)() : value;
}

async function resolveRequiredValue<T>(value: T | (() => Promise<T> | T)): Promise<T> {
  return typeof value === "function" ? await (value as () => Promise<T> | T)() : value;
}
