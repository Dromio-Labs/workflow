import {
  interactiveWorkflowViewCapabilities,
  createWorkflowViewCommandResult,
  normalizeWorkflowResultPresentation,
  validateWorkflowViewCommand,
  withWorkflowViewValidation,
  type WorkflowViewCommand,
  type WorkflowViewCommandResult,
  type WorkflowViewSnapshot,
} from "@dromio/workflow-room-protocol";
import {
  projectWorkflowGraphRenderModel,
  type WorkflowRenderInteraction,
} from "../workflow-render/index.js";
import {
  projectEventRecord,
  projectHookRequest,
  projectWorkflowRenderModelToWorkflowRoom,
} from "../workflow-room/projection.js";
import {
  toWorkflowRoomJsonObject,
  toWorkflowRoomJsonValue,
} from "../workflow-room/json.js";
import {
  formatWorkflowAppResult,
  type WorkflowApp,
  type WorkflowAppRun,
} from "./workflow-app.js";
import {
  workflowRenderStatuses,
} from "./workflow-diagram-render-layout.js";
import {
  projectWorkflowRun,
} from "./workflow-run-projection.js";

export function workflowViewSnapshotFromWorkflowAppRun(input: {
  app: WorkflowApp;
  commandResults?: WorkflowViewCommandResult[];
  run: WorkflowAppRun;
  selectedStepId?: string;
}): WorkflowViewSnapshot {
  const graph = input.app.graph(input.run.workflowId);
  const entryTriggers = input.app.listWorkflows()
    .find((workflow) => workflow.id === input.run.workflowId)?.triggers;
  const projection = projectWorkflowRun({
    events: input.run.events,
    graph,
    input: input.run.input,
  });
  const selectedNodeId = input.selectedStepId ?? pendingHookStepId(input.run) ?? projection.currentStepId;
  const render = projectWorkflowGraphRenderModel({
    ...(entryTriggers?.length ? { entryTriggers } : {}),
    graph,
    interactions: pendingRenderInteractions(input.run),
    ...(selectedNodeId ? { selectedNodeId } : {}),
    selectedRoutes: selectedRoutesFromRun(input.run),
    statuses: workflowRenderStatuses(projection),
    terminalOutcome: terminalOutcomeFromRun(input.run),
  });
  const pendingHooks = (input.run.session.pendingHooks ?? []).map((hook) => ({
    ...projectHookRequest(hook),
    runId: input.run.runId,
  }));
  const commandResults = [
    ...workflowViewCommandResultsFromRunEvents(input.run),
    ...(input.commandResults ?? []),
  ];
  const result = input.run.session.status === "completed"
    ? normalizeWorkflowResultPresentation(formatWorkflowAppResult(
      input.app.getWorkflow(input.run.workflowId),
      input.run.session,
    ), { title: "Workflow result" })
    : undefined;

  return withWorkflowViewValidation({
    capabilities: interactiveWorkflowViewCapabilities,
    ...(commandResults.length ? { commandResults } : {}),
    generatedAt: new Date().toISOString(),
    metadata: {
      source: "sdk.workflow-app-run",
      workflowId: input.run.workflowId,
    },
    pendingHooks,
    render: projectWorkflowRenderModelToWorkflowRoom(render),
    ...(result ? { result } : {}),
    run: {
      checkpoints: (input.run.session.checkpoints ?? []).map(toWorkflowRoomJsonValue),
      events: input.run.events.map(projectEventRecord),
      input: toWorkflowRoomJsonValue(input.run.input),
      pendingHooks,
      pendingQuestions: input.run.session.pendingQuestions.map(toWorkflowRoomJsonValue),
      ...(result ? { result: toWorkflowRoomJsonValue(result) } : {}),
      runId: input.run.runId,
      state: toWorkflowRoomJsonObject(input.run.session.state),
      status: input.run.session.status,
      workflowId: input.run.workflowId,
      workflowKey: input.run.workflowId,
    },
    ...(render.selectedNodeId ? { selectedNodeId: render.selectedNodeId } : {}),
    version: "workflow-view/v1",
  });
}

function workflowViewCommandResultsFromRunEvents(run: WorkflowAppRun): WorkflowViewCommandResult[] {
  return run.events
    .filter((event) => event.type === "workflow.ui.command")
    .flatMap((event) => {
      const command = workflowViewCommandFromEvent(event.detail);
      if (!command) return [];
      return [createWorkflowViewCommandResult({
        command,
        dispatch: {
          mode: "runtime" as const,
          runtimeResumed: run.session.status !== "waiting",
        },
      })];
    });
}

function workflowViewCommandFromEvent(detail: unknown): WorkflowViewCommand | undefined {
  if (!detail || typeof detail !== "object") return undefined;
  const command = (detail as { command?: unknown }).command;
  const validation = validateWorkflowViewCommand(command);
  return validation.ok ? validation.command : undefined;
}

function pendingHookStepId(run: WorkflowAppRun): string | undefined {
  return run.session.pendingHooks?.[0]?.stepId;
}

function pendingRenderInteractions(run: WorkflowAppRun): WorkflowRenderInteraction[] {
  return (run.session.pendingHooks ?? []).flatMap((hook) => {
    const kind = hook.kind;
    if (kind !== "approval" && kind !== "question" && kind !== "timer") return [];
    return [{ kind, state: "waiting" as const, stepId: hook.stepId }];
  });
}

function selectedRoutesFromRun(run: WorkflowAppRun) {
  const selected: Record<string, string> = {};
  for (const event of run.events) {
    if (event.type !== "router.selected" || !event.stepId) continue;
    const detail = event.detail && typeof event.detail === "object" && !Array.isArray(event.detail)
      ? event.detail as Readonly<Record<string, unknown>>
      : undefined;
    if (typeof detail?.routeId === "string") selected[event.stepId] = detail.routeId;
  }
  return selected;
}

function terminalOutcomeFromRun(run: WorkflowAppRun) {
  if (run.session.status === "failed") return "failed" as const;
  if (run.session.status === "cancelled") return "cancelled" as const;
  return "result" as const;
}
