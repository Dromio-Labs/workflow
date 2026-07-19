/** @jsxImportSource @opentui/solid */
import { type QuestionDockController } from "../opentui-workflow-renderer.impl.js";
import { type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { type WorkflowRunSemanticRow, type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { runDurationText } from "./activity-table.js";
import { detailStepStatus, stepDetailTitle } from "./artifact-step-pages.js";
import { stepStatusColor } from "./routing-keyboard.js";
import { activityRowNeedsAnswer, ActivityTimeline } from "./sidebar.js";
import { truncate } from "./string-format.js";
import { THEME } from "./style.js";
import { type TuiWorkspaceFrame } from "./types.js";
import { For, Show } from "solid-js";

export function ActiveRunSessionPanel(props: {
  questionActive: boolean;
  questionController: QuestionDockController;
  selectedStep?: WorkflowRunStoreSnapshot["steps"][number];
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  workflow: WorkflowAppWorkflowDescriptor;
  workspaceFrame?: TuiWorkspaceFrame;
}) {
  const step = () => props.selectedStep;
  const pendingQuestions = () => props.snapshot.pendingQuestions.length;
  const contextStatus = () => pendingQuestions() > 0
    ? `${pendingQuestions()} question${pendingQuestions() === 1 ? "" : "s"} waiting`
    : props.snapshot.status;
  const stepRows = () => {
    const selected = step();
    if (!selected || selected.boundary === "end") return compactActiveRunRows(props.snapshot.transcript);
    return compactActiveRunRows(props.snapshot.transcript, selected.id);
  };
  const modelLines = () => activeRunStepModelLines(step(), props.snapshot);
  const stepPosition = () => {
    const selected = step();
    if (!selected || selected.boundary) return undefined;
    const executable = props.snapshot.steps.filter((candidate) => candidate.boundary !== "trigger");
    const index = executable.findIndex((candidate) => candidate.id === selected.id);
    return index >= 0 ? `step ${index + 1} of ${executable.length}` : undefined;
  };
  return (
    <box
      backgroundColor={THEME.background}
      flexDirection="column"
      flexShrink={0}
      gap={1}
      minHeight={0}
      overflow="hidden"
      width={58}
    >
      <box
        backgroundColor={THEME.background}
        border={["top", "right", "bottom", "left"]}
        borderColor={THEME.border}
        flexDirection="column"
        flexShrink={0}
        height={10}
        overflow="hidden"
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
      >
        <box border={["bottom"]} borderColor={THEME.border} flexDirection="row" flexShrink={0} height={2}>
          <text fg={THEME.accent} flexGrow={1} height={1} truncate={true}>CONTEXT</text>
          <text fg={props.questionActive ? THEME.warning : THEME.muted} height={1} truncate={true}>
            {contextStatus()}
          </text>
        </box>
        <box flexDirection="column" paddingTop={1}>
          <ActiveContextRow label="Workflow" value={props.workflow.title} />
          <ActiveContextRow label="Run" value={props.snapshot.runId} />
          <ActiveContextRow label="Mode" value={props.workflow.id} />
          <ActiveContextRow label="Elapsed" value={runDurationText(props.snapshot, props.snapshot.status) || "running"} />
          <ActiveContextRow label="Workspace" value={props.workspaceFrame?.status ?? "valid"} />
          <For each={modelLines().slice(0, 2)}>
            {(line, index) => <ActiveContextRow label={index() === 0 ? "Model" : "Provider"} value={line} />}
          </For>
        </box>
      </box>
      <box
        backgroundColor={THEME.background}
        border={["top", "right", "bottom", "left"]}
        borderColor={THEME.border}
        flexDirection="column"
        flexGrow={1}
        minHeight={0}
        overflow="hidden"
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
      >
        <box border={["bottom"]} borderColor={THEME.border} flexDirection="row" flexShrink={0} height={2}>
          <text fg={THEME.accent} flexGrow={1} height={1} truncate={true}>ACTIVITY</text>
          <text fg={THEME.muted} height={1} truncate={true}>All | Steps | Operations | Model</text>
        </box>
        <Show when={step()}>
          {(selected) => (
            <box flexDirection="column" flexShrink={0} paddingTop={1}>
              <box flexDirection="row" flexShrink={0}>
                <box flexDirection="column" flexGrow={1}>
                  <text fg={stepStatusColor(selected().status)} height={1} truncate={true}>
                    {stepDetailTitle(selected())}
                  </text>
                  <text fg={stepStatusColor(selected().status)} height={1} truncate={true}>
                    {activeRunStepStatusText(selected(), props.snapshot)}
                  </text>
                </box>
                <Show when={stepPosition()}>
                  {(position) => (
                    <box
                      border={["top", "right", "bottom", "left"]}
                      borderColor={THEME.warning}
                      flexShrink={0}
                      height={3}
                      paddingLeft={1}
                      paddingRight={1}
                    >
                      <text fg={THEME.warning} height={1} truncate={true}>{position()}</text>
                    </box>
                  )}
                </Show>
              </box>
            </box>
          )}
      </Show>
      <Show when={props.questionActive}>
          <box backgroundColor={THEME.background} flexDirection="column" flexShrink={0} paddingTop={1}>
            <text fg={THEME.muted} height={1} truncate={true}>Consultation</text>
            <text fg={THEME.warning} height={1} truncate={true}>answer required before materializing</text>
          </box>
        </Show>
        <box backgroundColor={THEME.background} flexDirection="column" flexShrink={0} paddingTop={1}>
          <ActivityTimeline rows={stepRows()} width={53} />
        </box>
      </box>
    </box>
  );
}

export function ActiveContextRow(props: {
  label: string;
  value?: string;
  valueFg?: string;
}) {
  return (
    <box flexDirection="row" height={1}>
      <text fg={THEME.muted} height={1} truncate={true} width={17}>{props.label}</text>
      <text fg={props.valueFg ?? THEME.text} flexGrow={1} height={1} truncate={true}>{props.value ?? "none"}</text>
    </box>
  );
}

export function compactActiveRunRows(rows: WorkflowRunSemanticRow[], stepId?: string) {
  const relevant = stepId
    ? rows.filter((row) => row.stepId === stepId || row.parentStepId === stepId)
    : rows;
  const visible = relevant.filter((row) => row.phaseTitle.toLowerCase() !== "questions");
  const answerRow = [...visible].reverse().find(activityRowNeedsAnswer);
  const activityRows = visible.filter((row) => row !== answerRow && !activityRowNeedsAnswer(row));
  const picked: WorkflowRunSemanticRow[] = [];
  const modelRow = [...activityRows]
    .reverse()
    .find((row) => `${row.phaseId} ${row.phaseTitle}`.toLowerCase().includes("model"));
  const workerRow = [...activityRows]
    .reverse()
    .find((row) => row !== modelRow && `${row.phaseId} ${row.phaseTitle}`.toLowerCase().includes("worker"));
  for (const row of [modelRow, workerRow]) {
    if (row && !picked.includes(row)) picked.push(row);
  }
  for (const row of activityRows.slice(-2)) {
    if (picked.length >= 2) break;
    if (!picked.includes(row)) picked.push(row);
  }
  if (answerRow) picked.push(answerRow);
  return picked.slice(-3);
}

export function activeRunStepStatusText(
  step: WorkflowRunStoreSnapshot["steps"][number],
  snapshot: WorkflowRunStoreSnapshot,
) {
  if (step.status === "waiting" && snapshot.pendingQuestions.length > 0) return "waiting for answers";
  return detailStepStatus(step);
}

export function activeRunStepModelText(
  step: WorkflowRunStoreSnapshot["steps"][number] | undefined,
  snapshot: WorkflowRunStoreSnapshot,
) {
  if (!step || step.boundary) return undefined;
  const observed = activeRunObservedModel(step, snapshot);
  const selected = [...(step.models ?? [])].reverse().find((model) => model.selected)?.selected;
  if (selected) return modelOptionSummary(selected, observed);
  if (observed?.model || observed?.provider) return providerModelSummary(observed.provider, observed.model);
  return undefined;
}

export function activeRunStepModelLines(
  step: WorkflowRunStoreSnapshot["steps"][number] | undefined,
  snapshot: WorkflowRunStoreSnapshot,
) {
  const line = activeRunStepModelText(step, snapshot);
  if (!line) return [];
  const match = /^model (.+?) · (.+ -> .+)$/.exec(line);
  if (match) return [`model ${match[1]}`, match[2]!];
  return [line];
}

export function activeRunObservedModel(
  step: WorkflowRunStoreSnapshot["steps"][number],
  snapshot: WorkflowRunStoreSnapshot,
) {
  const conversation = [...snapshot.conversations].reverse().find((item) => item.stepId === step.id && (item.model || item.provider));
  if (conversation?.model || conversation?.provider) {
    return { model: conversation.model, provider: conversation.provider };
  }
  const row = [...snapshot.transcript].reverse().find((item) => item.stepId === step.id && (item.model || item.provider));
  if (row?.model || row?.provider) return { model: row.model, provider: row.provider };
  return undefined;
}

export function modelOptionSummary(model: {
  id?: string;
  label?: string;
  model?: string;
  worker?: string;
}, observed?: { model?: string; provider?: string }) {
  const label = model.label ?? model.id ?? "model";
  const provider = model.worker ?? "worker";
  if (model.model) return `model ${label} · ${provider}/${model.model}`;
  const resolved = providerModelValue(observed?.provider, observed?.model);
  if (resolved) return `model ${label} · ${provider} default -> ${resolved}`;
  return `model ${label} · ${provider} default`;
}

export function providerModelSummary(provider: string | undefined, model: string | undefined) {
  const value = providerModelValue(provider, model);
  if (value) return `model ${value}`;
  return undefined;
}

export function providerModelValue(provider: string | undefined, model: string | undefined) {
  if (model?.includes("/")) return model;
  if (provider && model) return `${provider}/${model}`;
  if (model) return model;
  if (provider) return `${provider} default`;
  return undefined;
}

export function modelWorkerOptionLabel(option: {
  id: string;
  label?: string;
  model?: string;
  worker?: string;
}) {
  return option.label ?? providerModelValue(option.worker, option.model) ?? option.id;
}
