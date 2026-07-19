/** @jsxImportSource @opentui/solid */
import { type WorkflowTuiTriggerBoundarySummary } from "../workflow-app-tui.js";
import { type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { ActivityTable, formatStepModel, stepPromptModels } from "./activity-table.js";
import { detailParentStepId, detailStepStatus, displayText, isNestedWorkflowStep, nestedStepById, nestedStepRows, paintDisplaySpaces, portKeys, rowMatchesNestedStep, stepDetailTitle, workflowStepChildWorkflowId, type WorkflowStepDetailTarget, workflowStepExecutionDetail } from "./artifact-step-pages.js";
import { inputDraftPreview } from "./input-form.js";
import { MetadataRow, MetadataSection } from "./metadata-sections.js";
import { stepRailChildItems, stepRailLoopBadge, stepRailLoopRange } from "./step-rail.js";
import { truncate, truncateToWidth } from "./string-format.js";
import { THEME } from "./style.js";
import { formatStepPrompt } from "./workflow-file-helpers.js";
import { createSignal, For, Show } from "solid-js";

export function StepDetail(props: {
  inputDraft: string;
  onOpenActivityContent(title: string, content: string): void;
  onOpenStepData(step: WorkflowStepDetailTarget): void;
  onSelectStep(stepId: string): void;
  selectedStepId?: string;
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  triggerSummary?: WorkflowTuiTriggerBoundarySummary;
}) {
  const [selectedDetailTab, setSelectedDetailTab] = createSignal<"activity" | "details">("activity");
  const selectedStep = () =>
    props.snapshot.steps.find((step) => step.id === props.selectedStepId) ??
    nestedStepById(props.snapshot, props.selectedStepId) ??
    props.snapshot.currentStep ??
    props.snapshot.steps[0];
  const activityRows = () => {
    const step = selectedStep();
    if (!step) return [];
    if (isNestedWorkflowStep(step)) {
      return props.snapshot.transcript
        .filter((row) => row.parentStepId === step.parentStepId && rowMatchesNestedStep(row, step))
        .slice(-20);
    }
    if (step.boundary === "end") {
      return props.snapshot.transcript;
    }
    return props.snapshot.transcript
      .filter((row) => row.stepId === step.id || row.parentStepId === step.id)
      .slice(-40);
  };
  const loops = () => {
    const step = selectedStep();
    if (!step || isNestedWorkflowStep(step)) return [];
    return props.snapshot.loops.filter((loop) => loop.fromStepId === step.id || loop.targetStepId === step.id);
  };
  const pendingQuestions = () => {
    const step = selectedStep();
    return step?.id && !isNestedWorkflowStep(step) && props.snapshot.currentStepId === step.id ? props.snapshot.pendingQuestions : [];
  };
  const nestedSteps = () => {
    const step = selectedStep();
    if (!step || isNestedWorkflowStep(step)) return [];
    const parentStep = props.snapshot.steps.find((candidate) => candidate.id === step.id);
    return parentStep ? nestedStepRows(props.snapshot, parentStep) : [];
  };
  const childWorkflowSummaryLines = () => {
    const step = selectedStep();
    if (!step || isNestedWorkflowStep(step)) return [];
    const rows = nestedSteps();
    if (rows.length === 0) return [];
    const childWorkflowId = workflowStepChildWorkflowId(step);
    const lines = [
      `${childWorkflowId ? `${childWorkflowId} · ` : ""}${rows.length} nested steps`,
    ];
    for (const item of stepRailChildItems(rows)) {
      if (item.kind !== "loop") continue;
      const first = item.rows[0]?.indexLabel;
      const last = item.rows.at(-1)?.indexLabel;
      if (!first || !last) continue;
      lines.push(`loop ${stepRailLoopRange(item.rows)} · ${stepRailLoopBadge(step)} · ${last} returns to ${first}`);
    }
    return lines;
  };
  return (
    <box flexDirection="column" flexGrow={1}>
      <Show when={selectedStep()} fallback={<text fg={THEME.muted}>No step selected.</text>}>
        {(step) => (
	          <>
	            <text fg={THEME.accent}>Step Detail</text>
	            <StepDetailTabs selected={selectedDetailTab()} onSelect={setSelectedDetailTab} />
	            <Show when={selectedDetailTab() === "details"}>
	              <>
	                <text fg={THEME.text} height={1} truncate={true}>
	                  {paintDisplaySpaces(stepDetailTitle(step()))}
	                </text>
	                <DetailLine label="id" value={step().id} />
	                <DetailLine
	                  label="status"
	                  value={`${detailStepStatus(step())}${step().attempt ? ` · attempt ${step().attempt}` : ""}`}
	                />
                <Show when={stepUsesModel(step())}>
	                  <DetailLine label="engine" value="LLM" />
	                </Show>
	                <Show when={detailParentStepId(step())}>
	                  {(parentStepId) => <DetailLine label="parent" value={parentStepId()} />}
	                </Show>
	                <Show when={step().catalogItemId}>
	                  {(catalogItemId) => <DetailLine label="catalog" value={catalogItemId()} />}
	                </Show>
	                <Show when={step().catalog?.kind}>
	                  {(kind) => <DetailLine label="kind" value={kind()} />}
	                </Show>
	                <Show when={workflowStepExecutionDetail(step())}>
	                  {(execution) => <DetailLine label="execution" value={execution()} />}
	                </Show>
	                <Show when={portKeys(step().input).length > 0}>
	                  <DetailLine label="inputs" value={portKeys(step().input).join(", ")} />
	                </Show>
	                <Show when={portKeys(step().output).length > 0}>
	                  <DetailLine label="outputs" value={portKeys(step().output).join(", ")} />
	                </Show>
	                <Show when={(step().catalog?.sideEffects?.length ?? 0) > 0}>
	                  <DetailLine label="side effects" value={(step().catalog?.sideEffects ?? []).join(", ")} />
	                </Show>
	                <Show when={(step().catalog?.tags?.length ?? 0) > 0}>
	                  <DetailLine label="tags" value={(step().catalog?.tags ?? []).join(", ")} />
	                </Show>
	                <Show when={typeof step().score === "number"}>
	                  <DetailLine label="score" value={`${Math.round((step().score ?? 0) * 100)}%`} />
	                </Show>
	                <Show when={step().note}>
	                  {(note) => <DetailLine label="note" value={note()} />}
	                </Show>
	                <StepRuntimeDataPreview
	                  step={step()}
	                  onOpen={() => props.onOpenStepData(step())}
	                />
	                <Show when={props.triggerSummary}>
	                  {(summary) => (
	                    <>
	                      <MetadataSection rowCount={3} title="TRIGGER BOUNDARY" separated={true}>
	                        <MetadataRow label="id" value={summary().boundaryId} />
	                        <MetadataRow label="type" value={summary().boundaryType} />
	                        <MetadataRow label="input port" value={summary().inputKeys.join(", ") || "none"} />
	                      </MetadataSection>
	                      <MetadataSection rowCount={2} title="CURRENT INPUT" separated={true}>
	                        <MetadataRow label="field" value={summary().inputKeys[0] ?? summary().boundaryId} />
	                        <MetadataRow label="draft" value={inputDraftPreview(props.inputDraft)} />
	                      </MetadataSection>
	                    </>
	                  )}
	                </Show>
	                <Show when={(step().models?.length ?? 0) > 0}>
	                  <box flexDirection="column" height={(step().models?.length ?? 0) + 2} paddingTop={1}>
	                    <text fg={THEME.muted}>Models</text>
	                    <For each={step().models ?? []}>
	                      {(model) => (
	                        <text fg={THEME.text} height={1} truncate={true}>
	                          {paintDisplaySpaces(`${displayText(model.label ?? model.operation)}: ${formatStepModel(model)}`)}
	                        </text>
	                      )}
	                    </For>
	                  </box>
	                </Show>
	                <Show when={stepPromptModels(step()).length > 0}>
	                  <box flexDirection="column" height={(stepPromptModels(step()).length * 2) + 2} paddingTop={1}>
	                    <text fg={THEME.muted}>Prompts</text>
	                    <For each={stepPromptModels(step())}>
	                      {(model) => (
	                        <box flexDirection="column" height={2}>
	                          <text fg={THEME.text} height={1} truncate={true}>
	                            {paintDisplaySpaces(displayText(model.label ?? model.operation))}
	                          </text>
	                          <text fg={THEME.muted} height={1} truncate={true}>
	                            {formatStepPrompt(model.prompt)}
	                          </text>
	                        </box>
	                      )}
	                    </For>
	                  </box>
	                </Show>
	                <Show when={step().description}>
	                  {(description) => (
	                    <box flexDirection="column" paddingTop={1}>
	                      <text fg={THEME.muted}>Description</text>
	                      <text fg={THEME.text} height={1} truncate={true}>
	                        {paintDisplaySpaces(displayText(description()))}
	                      </text>
	                    </box>
	                  )}
	                </Show>
	                <Show when={pendingQuestions().length > 0}>
	                  <box flexDirection="column" paddingTop={1}>
	                    <text fg={THEME.warning}>Pending questions</text>
	                    <For each={pendingQuestions()}>
	                      {(question) => (
	                        <text fg={THEME.text} height={1} truncate={true}>
	                          {paintDisplaySpaces(`${question.id}: ${displayText(question.prompt)}`)}
	                        </text>
	                      )}
	                    </For>
	                  </box>
	                </Show>
	                <Show when={loops().length > 0}>
	                  <box flexDirection="column" paddingTop={1}>
	                    <text fg={THEME.warning}>Loops</text>
	                    <For each={loops()}>
	                      {(loop) => (
	                        <text fg={THEME.text} height={1} truncate={true}>
	                          {paintDisplaySpaces(`${loop.fromStepId} -> ${loop.targetStepId}${loop.reason ? ` · ${displayText(loop.reason)}` : ""}`)}
	                        </text>
	                      )}
	                    </For>
	                  </box>
	                </Show>
	                <Show when={childWorkflowSummaryLines().length > 0}>
	                  <box flexDirection="column" height={childWorkflowSummaryLines().length + 2} paddingTop={1}>
	                    <text fg={THEME.muted}>Child workflow</text>
	                    <For each={childWorkflowSummaryLines()}>
	                      {(line, index) => (
	                        <text fg={index() === 0 ? THEME.text : THEME.info} height={1} truncate={true}>
	                          {paintDisplaySpaces(line)}
	                        </text>
	                      )}
	                    </For>
	                  </box>
	                </Show>
	              </>
	            </Show>
	            <Show when={selectedDetailTab() === "activity"}>
	              <box flexDirection="column" flexGrow={1} minHeight={0} paddingTop={1}>
	                <text fg={THEME.muted} height={1} truncate={true}>{stepDetailTitle(step())} · Activity</text>
	                <scrollbox flexGrow={1} minHeight={0} stickyScroll={false}>
	                  <ActivityTable
	                    conversations={props.snapshot.conversations}
	                    emptyText="No events for this step yet."
	                    rows={activityRows()}
	                    spinnerFrame={props.spinnerFrame}
	                    onOpenRowContent={props.onOpenActivityContent}
	                  />
	                </scrollbox>
	              </box>
	            </Show>
	          </>
	        )}
      </Show>
    </box>
  );
}

export function StepDetailTabs(props: {
  onSelect(tab: "activity" | "details"): void;
  selected: "activity" | "details";
}) {
  return (
    <box flexDirection="row" height={1}>
      <StepDetailTab
        active={props.selected === "activity"}
        label="ACTIVITY"
        onSelect={() => props.onSelect("activity")}
      />
      <text fg={THEME.muted} height={1}> </text>
      <StepDetailTab
        active={props.selected === "details"}
        label="DETAILS"
        onSelect={() => props.onSelect("details")}
      />
    </box>
  );
}

export function StepDetailTab(props: {
  active: boolean;
  label: string;
  onSelect(): void;
}) {
  return (
    <box backgroundColor={props.active ? THEME.selected : undefined} height={1} paddingLeft={1} paddingRight={1} onMouseUp={props.onSelect}>
      <text fg={props.active ? THEME.accent : THEME.muted} height={1}>
        {props.label}
      </text>
    </box>
  );
}

export function DetailLine(props: {
  label: string;
  value: number | string;
}) {
  return (
    <text fg={THEME.text} height={1} truncate={true}>
      {paintDisplaySpaces(`${props.label}: ${displayText(String(props.value))}`)}
    </text>
  );
}

export function StepRuntimeDataPreview(props: {
  onOpen(): void;
  step: WorkflowStepDetailTarget;
}) {
  const rows = () => stepRuntimeDataRows(props.step);
  return (
    <Show when={rows().length > 0}>
      <box
        flexDirection="column"
        height={rows().length + 2}
        paddingTop={1}
        onMouseUp={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onOpen();
        }}
      >
        <text fg={THEME.muted} height={1} truncate={true}>
          Runtime data
        </text>
        <For each={rows()}>
          {(row) => (
            <text fg={row.fg} height={1} truncate={true}>
              {paintDisplaySpaces(`${row.label}: ${row.preview}`)}
            </text>
          )}
        </For>
      </box>
    </Show>
  );
}

export function stepRuntimeDataRows(step: WorkflowStepDetailTarget) {
  return [
    runtimeDataRow("input", step.runtimeInput, THEME.info),
    runtimeDataRow("output", step.runtimeOutput, THEME.success),
  ].filter((row): row is { fg: string; label: string; preview: string } => Boolean(row));
}

export function runtimeDataRow(label: string, value: unknown, fg: string) {
  if (value === undefined) return undefined;
  return {
    fg,
    label,
    preview: truncateToWidth(runtimeDataPreview(value), 120),
  };
}

export function runtimeDataPreview(value: unknown) {
  return compactJsonString(value).replace(/\s+/g, " ").trim() || "empty";
}

export function stepRuntimeDataContent(step: WorkflowStepDetailTarget) {
  const payload: Record<string, unknown> = {};
  if (step.runtimeInput !== undefined) payload.input = step.runtimeInput;
  if (step.runtimeOutput !== undefined) payload.output = step.runtimeOutput;
  if (Object.keys(payload).length === 0) return undefined;
  return compactJsonString({
    step: {
      id: step.id,
      label: step.label,
      status: detailStepStatus(step),
    },
    ...payload,
  }, 2);
}

export function compactJsonString(value: unknown, space = 0) {
  try {
    return JSON.stringify(value, jsonPreviewReplacer(), space) ?? String(value);
  } catch {
    return String(value);
  }
}

function stepUsesModel(step: WorkflowStepDetailTarget) {
  if ((step.models?.length ?? 0) > 0) return true;
  const metadata = [
    ...(step.catalog?.capabilities ?? []),
    ...(step.catalog?.sideEffects ?? []),
    ...(step.catalog?.tags ?? []),
  ].map((value) => value.toLowerCase());
  return metadata.some((value) =>
    value === "model" || value === "llm" || value === "model.call"
  );
}

export function jsonPreviewReplacer() {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown) => {
    if (value === undefined) return "[undefined]";
    if (typeof value === "bigint") return value.toString();
    if (typeof value !== "object" || value === null) return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value;
  };
}
