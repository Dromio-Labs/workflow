/** @jsxImportSource @opentui/solid */
import { type TriggerDescriptor } from "../../../workflow-control-plane/index.js";
import { workflowTuiTriggerBoundarySummary } from "../workflow-app-tui.js";
import { type WorkflowApp, type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { type WorkflowRunSemanticRow, type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { artifactContent, artifactDisplayPath, selectedArtifactFor } from "./dialogs-popups.js";
import { stepStatus } from "./routing-keyboard.js";
import { StepDetail } from "./step-detail-view.js";
import { StepRail } from "./step-rail.js";
import { truncate } from "./string-format.js";
import { THEME } from "./style.js";
import { type TuiArtifact, type WorkflowConfigField } from "./types.js";
import { workflowDesignChildStepId, workflowDesignNodes } from "./workflow-design.js";
import * as path from "node:path";
import { For, Show } from "solid-js";

export function WorkflowArtifactPage(props: {
  artifacts: TuiArtifact[];
  artifactName: string;
  error: string;
  result: string;
  selectedArtifactName?: string;
  selectedStepId?: string;
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  onSelectStep(stepId: string): void;
}) {
  const selectedArtifact = () =>
    selectedArtifactFor(props.artifacts, props.selectedArtifactName);
  const displayName = () => selectedArtifact()?.name ?? props.artifactName;
  const content = () => artifactContent({
    artifact: selectedArtifact(),
    artifactName: props.artifactName,
    error: props.error,
    result: props.result,
    snapshot: props.snapshot,
  });
  return (
    <box flexDirection="row" flexGrow={1} gap={1}>
      <StepRail
        selectedStepId={props.selectedStepId}
        snapshot={props.snapshot}
        spinnerFrame={props.spinnerFrame}
        onSelectStep={props.onSelectStep}
      />
      <box flexDirection="column" flexGrow={1} minHeight={0}>
        <text fg={THEME.accent}>Artifact</text>
        <box
          flexDirection="column"
          flexGrow={1}
          marginTop={1}
          minHeight={0}
        >
          <Show keyed when={displayName()}>
            {(name) => (
              <ArtifactReader
                artifact={selectedArtifact()}
                content={content()}
                error={props.error}
                name={name}
              />
            )}
          </Show>
        </box>
      </box>
    </box>
  );
}

export function ArtifactReader(props: {
  artifact?: TuiArtifact;
  content: string;
  error: string;
  name: string;
}) {
  return (
    <>
      <text fg={THEME.success}>{props.name}</text>
      <Show when={props.artifact?.path}>
        {(artifactPath) => <text fg={THEME.muted}>{artifactDisplayPath(artifactPath())}</text>}
      </Show>
      <scrollbox
        flexGrow={1}
        marginTop={1}
        stickyScroll={false}
      >
        <For each={props.content.split("\n")}>
          {(line) => <text fg={props.error ? THEME.error : THEME.text}>{line || " "}</text>}
        </For>
      </scrollbox>
    </>
  );
}

export function WorkflowStepDetailPage(props: {
  app: WorkflowApp;
  collapsedStepIds: ReadonlySet<string>;
  inputDraft: string;
  selectedStepId?: string;
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  triggers: TriggerDescriptor[];
  workflow: WorkflowAppWorkflowDescriptor;
  onOpenActivityContent(title: string, content: string): void;
  onOpenStepData(step: WorkflowStepDetailTarget): void;
  onSelectStep(stepId: string): void;
  onToggleStepCollapsed(stepId: string): void;
}) {
  const graph = () => props.app.graph(props.workflow.id);
  const selectedDesignNode = () => workflowDesignNodes(graph()).find((step) => step.id === props.selectedStepId);
  const selectedTriggerSummary = () => {
    const step = selectedDesignNode();
    if (step?.boundary !== "trigger") return undefined;
    return workflowTuiTriggerBoundarySummary({
      trigger: graph().trigger ?? {
        id: step.id,
        type: step.triggerType,
      },
      triggers: props.triggers,
      workflowId: props.workflow.id,
    });
  };
  return (
    <box flexDirection="row" flexGrow={1} gap={1}>
      <StepRail
        collapsedStepIds={props.collapsedStepIds}
        selectedStepId={props.selectedStepId}
        snapshot={props.snapshot}
        spinnerFrame={props.spinnerFrame}
        onSelectStep={props.onSelectStep}
        onToggleCollapsed={props.onToggleStepCollapsed}
      />
      <StepDetail
        inputDraft={props.inputDraft}
        selectedStepId={props.selectedStepId}
        snapshot={props.snapshot}
        spinnerFrame={props.spinnerFrame}
        triggerSummary={selectedTriggerSummary()}
        onOpenActivityContent={props.onOpenActivityContent}
        onOpenStepData={props.onOpenStepData}
        onSelectStep={props.onSelectStep}
      />
    </box>
  );
}

export type WorkflowStepDetailTarget = {
  attempt?: number;
  boundary?: "end" | "trigger";
  catalog?: WorkflowRunStoreSnapshot["steps"][number]["catalog"];
  catalogItemId?: string;
  description?: string;
  id: string;
  index?: number;
  indexLabel?: string;
  input?: WorkflowRunStoreSnapshot["steps"][number]["input"];
  label: string;
  loop?: NonNullable<NonNullable<WorkflowRunStoreSnapshot["steps"][number]["childNodes"]>[number]["loop"]>;
  loopBody?: boolean;
  models?: WorkflowRunStoreSnapshot["steps"][number]["models"];
  nested?: boolean;
  note?: string;
  output?: WorkflowRunStoreSnapshot["steps"][number]["output"];
  parentStepId?: string;
  runtimeInput?: WorkflowRunStoreSnapshot["steps"][number]["runtimeInput"];
  runtimeOutput?: WorkflowRunStoreSnapshot["steps"][number]["runtimeOutput"];
  score?: number;
  status: string;
};

export type NestedWorkflowStepRow = WorkflowStepDetailTarget & {
  id: string;
  indexLabel: string;
  loop?: NonNullable<NonNullable<WorkflowRunStoreSnapshot["steps"][number]["childNodes"]>[number]["loop"]>;
  loopBody?: boolean;
  nested: true;
  parentStepId: string;
};

export function stepDetailTitle(step: WorkflowStepDetailTarget) {
  if (step.nested) return `${step.indexLabel ?? "↳"}${nestedStepLoopMarker(step)} ${displayText(step.label)}`;
  if (typeof step.index === "number") {
    return `${formatStepIndex(step as { boundary?: "end" | "trigger"; index: number })} ${displayText(step.label)}`;
  }
  return displayText(step.label);
}

export function formatStepIndex(step: { boundary?: "end" | "trigger"; index: number }) {
  if (step.boundary === "trigger") return "[start]";
  if (step.boundary === "end") return "[end]";
  return String(step.index).padStart(2, "0");
}

export function boundaryStepColor(step: { boundary?: "end" | "trigger" }) {
  if (step.boundary === "trigger") return THEME.success;
  if (step.boundary === "end") return THEME.warning;
  return undefined;
}

export function workflowDesignStepColor(step: { boundary?: "end" | "trigger" }, selected: boolean) {
  return boundaryStepColor(step) ?? (selected ? THEME.accent : THEME.text);
}

export function isWorkflowLoopStep(step: { catalog?: WorkflowRunStoreSnapshot["steps"][number]["catalog"] }) {
  const kind = step.catalog?.execution?.kind;
  return kind === "forEach" || kind === "loop";
}

export function workflowStepDisplayLabel(step: { label: string }) {
  return step.label;
}

export function workflowStepExecutionDetail(step: { catalog?: WorkflowRunStoreSnapshot["steps"][number]["catalog"] }) {
  const execution = step.catalog?.execution;
  if (!execution) return undefined;
  if (execution.kind === "forEach") {
    return [
      execution.label ?? "for each item",
      execution.itemSource ? `source ${execution.itemSource}` : "",
      execution.childWorkflowDocumentId ? `child ${execution.childWorkflowDocumentId}` : "",
    ].filter(Boolean).join(" · ");
  }
  return execution.label ?? execution.kind;
}

export function workflowStepChildWorkflowId(step: { catalog?: WorkflowRunStoreSnapshot["steps"][number]["catalog"] }) {
  const execution = step.catalog?.execution;
  return execution && "childWorkflowDocumentId" in execution ? execution.childWorkflowDocumentId : undefined;
}

export type WorkflowStepPromptDetailRow = {
  directory: string;
  file: string;
  path?: string;
  role: string;
};

export type WorkflowStepRelatedFileRow = {
  directory: string;
  file: string;
  path: string;
  role: string;
};

export type WorkflowOverviewRow = {
  fg?: string;
  label: string;
  value: string;
};

export type WorkflowMetadataSelectionRow =
  | {
      field: WorkflowConfigField;
      kind: "config";
    }
  | {
      kind: "file";
      path?: string;
    }
  | {
      kind: "line";
    };

export function stepRailStatusLine(step: WorkflowRunStoreSnapshot["steps"][number]) {
  return [
    workflowStepExecutionBadge(step),
    `  ${stepStatus(step.status)}`,
    typeof step.score === "number" ? `${Math.round(step.score * 100)}%` : "",
    step.note ? truncate(displayText(step.note), 16) : "",
  ].filter(Boolean).join(" · ");
}

export function workflowStepExecutionBadge(step: { catalog?: WorkflowRunStoreSnapshot["steps"][number]["catalog"] }) {
  const execution = step.catalog?.execution;
  if (!execution) return "";
  if (execution.kind === "forEach") return execution.label ?? "for each item";
  if (execution.kind === "loop") return execution.label ?? "loop";
  return "";
}

export function displayText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function paintDisplaySpaces(value: string) {
  return value.replaceAll(" ", "\u00a0");
}

export function nestedStepRows(
  snapshot: WorkflowRunStoreSnapshot,
  parentStep: WorkflowRunStoreSnapshot["steps"][number],
): NestedWorkflowStepRow[] {
  const rows = new Map<string, NestedWorkflowStepRow>();
  const useLoopIndex = isWorkflowLoopStep(parentStep);
  for (const [index, child] of (parentStep.childNodes ?? []).entries()) {
    const row: NestedWorkflowStepRow = {
      catalog: child.catalog,
      catalogItemId: child.catalogItemId,
      description: child.description ?? child.catalog?.description,
      id: nestedStaticStepId(parentStep.id, child.id),
      indexLabel: nestedStepIndexLabel(parentStep.index, index + 1, useLoopIndex),
      input: child.input,
      label: nestedStepDisplayLabel(child.catalogItemId ?? child.id, child.id),
      loop: child.loop,
      loopBody: Boolean(child.loop),
      nested: true,
      output: child.output,
      parentStepId: parentStep.id,
      status: nestedStepRuntimeStatus(snapshot, parentStep.id, child) ?? "pending",
    };
    rows.set(row.id, row);
  }
  for (const row of snapshot.transcript) {
    if (row.parentStepId !== parentStep.id || !row.stepId || row.stepId === parentStep.id) continue;
    if ([...rows.values()].some((nested) => rowMatchesNestedStep(row, nested))) continue;
    const id = row.stepId;
    const existing = rows.get(id);
    rows.set(id, {
      id: row.stepId,
      indexLabel: existing?.indexLabel ?? nestedStepIndexLabel(parentStep.index, rows.size + 1, useLoopIndex),
      label: nestedStepDisplayLabel(row.text || nestedStepLeafLabel(row.stepId), row.stepId),
      nested: true,
      note: row.durationLabel,
      parentStepId: parentStep.id,
      status: row.status,
    });
  }
  return [...rows.values()];
}

export function nestedStepLoopMarker(step: { loop?: NestedWorkflowStepRow["loop"] }) {
  if (!step.loop) return "";
  if (step.loop.role === "end") return "↺";
  return "↻";
}

export function nestedStaticStepId(parentStepId: string, childId: string) {
  return workflowDesignChildStepId(parentStepId, childId);
}

export function nestedStepById(snapshot: WorkflowRunStoreSnapshot, stepId: string | undefined) {
  if (!stepId) return undefined;
  for (const step of snapshot.steps) {
    const nestedStep = nestedStepRows(snapshot, step).find((row) => row.id === stepId);
    if (nestedStep) return nestedStep;
  }
  return undefined;
}

export function isNestedWorkflowStep(step: WorkflowStepDetailTarget): step is NestedWorkflowStepRow {
  return step.nested === true;
}

export function nestedStepLeafLabel(stepId: string) {
  const childSeparator = stepId.lastIndexOf("::");
  if (childSeparator >= 0) return stepId.slice(childSeparator + 2);
  const separator = stepId.lastIndexOf(".");
  return separator >= 0 ? stepId.slice(separator + 1) : stepId;
}

export function nestedStepIndexLabel(parentIndex: number, childIndex: number, localOnly = false) {
  const childLabel = String(childIndex).padStart(2, "0");
  if (localOnly) return childLabel;
  return `${String(parentIndex).padStart(2, "0")}.${childLabel}`;
}

export function nestedStepDisplayLabel(value: string, stepId: string) {
  const label = displayText(value)
    .replace(/\s+\[[^[\]]+\]$/, "")
    .replace(/\bimages\./g, "");
  return label || nestedStepLeafLabel(stepId).replace(/\bimages\./g, "");
}

export function portKeys(ports: WorkflowStepDetailTarget["input"] | WorkflowStepDetailTarget["output"]) {
  return (ports ?? []).map((port) => port.key);
}

export function nestedStepRuntimeStatus(
  snapshot: WorkflowRunStoreSnapshot,
  parentStepId: string,
  child: NonNullable<WorkflowRunStoreSnapshot["steps"][number]["childNodes"]>[number],
) {
  const rows = snapshot.transcript.filter((row) =>
    row.parentStepId === parentStepId && rowMatchesChildNode(row, child)
  );
  return rows.at(-1)?.status;
}

export function rowMatchesNestedStep(row: WorkflowRunSemanticRow, nested: NestedWorkflowStepRow) {
  if (row.stepId === nested.id) return true;
  if (nested.catalogItemId && row.operationId === nested.catalogItemId) return true;
  const aliases = [
    nested.catalogItemId,
    nested.catalog?.id,
    nested.catalog?.label,
    nested.label,
  ];
  return Boolean(row.itemWorkflowStepId && aliases.some((alias) =>
    alias && normalizeNestedStepKey(alias) === normalizeNestedStepKey(row.itemWorkflowStepId ?? "")
  ));
}

export function rowMatchesChildNode(
  row: WorkflowRunSemanticRow,
  child: NonNullable<WorkflowRunStoreSnapshot["steps"][number]["childNodes"]>[number],
) {
  if (child.catalogItemId && row.operationId === child.catalogItemId) return true;
  const aliases = [
    child.catalogItemId,
    child.catalog?.id,
    child.catalog?.label,
    child.label,
    child.id,
  ];
  return Boolean(row.itemWorkflowStepId && aliases.some((alias) =>
    alias && normalizeNestedStepKey(alias) === normalizeNestedStepKey(row.itemWorkflowStepId ?? "")
  ));
}

export function normalizeNestedStepKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\bimages\./g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function detailStepStatus(step: WorkflowStepDetailTarget) {
  if (!step.nested) return stepStatus(step.status);
  if (step.status === "ok") return "done";
  if (step.status === "error") return "failed";
  if (step.status === "warning") return "warning";
  if (step.status === "running") return "running";
  return "info";
}

export function detailParentStepId(step: WorkflowStepDetailTarget) {
  return isNestedWorkflowStep(step) ? step.parentStepId : undefined;
}
