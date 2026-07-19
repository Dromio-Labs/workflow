/** @jsxImportSource @opentui/solid */
import { type TriggerDescriptor } from "../../../workflow-control-plane/index.js";
import { type WorkflowTuiTriggerBoundarySummary } from "../workflow-app-tui.js";
import { type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { stepPromptDetailRows, stepRelatedFileRows } from "./activity-table.js";
import { workflowConfigFieldDisplay, workflowConfigFieldMissing, workflowConfigFieldVia } from "./config-utils.js";
import { parsePromptObject, publishedInputExampleLines, triggerInputExampleLines } from "./input-form.js";
import { ConfigMetadataHeader, ConfigMetadataRow, metadataLinesEqual, MetadataLinesSection, MetadataRow, MetadataSection, StepFilesSection, StepPromptFilesSection, visibleMetadataLineCount, WorkflowOverviewSection } from "./metadata-sections.js";
import { workspaceGraphCompact, workspaceIssueValue, workspaceLatestPatchValue, workspaceLatestTestColor, workspaceLatestTestValue, workspaceStatusColor } from "./sidebar.js";
import { truncate } from "./string-format.js";
import { THEME } from "./style.js";
import { type TuiWorkspaceFrame, type WorkflowConfigField, type WorkflowViewProtocolPanelMode } from "./types.js";
import { type WorkflowDesignNode } from "./workflow-design.js";
import { workflowOverviewRows, workflowRelatedFileRows } from "./workflow-file-helpers.js";
import { WorkflowViewProtocolPanel } from "./workflow-view-protocol-panel.js";
import type { WorkflowViewSnapshot } from "@dromio/workflow-room-protocol";
import { type MouseEvent as TuiMouseEvent } from "@opentui/core";
import * as path from "node:path";
import { For, Show } from "solid-js";

export function StartMetadataPanel(props: {
  active?: boolean;
  flexGrow?: number;
  inputDraft: string;
  selectedMetadataRowIndex?: number;
  selectedStep?: WorkflowDesignNode;
  selectedTriggerSummary?: WorkflowTuiTriggerBoundarySummary;
  width?: number;
  workflowViewProtocolMode?: WorkflowViewProtocolPanelMode;
  workflowViewSnapshot?: WorkflowViewSnapshot;
  workspaceFrame?: TuiWorkspaceFrame;
  workflow: WorkflowAppWorkflowDescriptor;
  configOverrides: Record<string, unknown>;
  onEditConfigValue(field: WorkflowConfigField): void;
  onOpenMetadataPopup?(): void;
  onOpenPromptFile(filePath: string): void;
  onSelectMetadataRow?(index: number): void;
}) {
  const draftConfig = () => parsePromptObject(props.inputDraft);
  const showWorkflowDetails = () => props.selectedStep?.boundary === "trigger";
  const workflowRows = () => showWorkflowDetails()
    ? workflowOverviewRows(props.workflow, props.selectedStep, props.selectedTriggerSummary, props.workspaceFrame)
    : [];
  const workflowFileRows = () => showWorkflowDetails()
    ? workflowRelatedFileRows(props.workflow, props.workspaceFrame)
    : [];
  const promptRows = () => stepPromptDetailRows(props.selectedStep ?? {});
  const stepFileRows = () => stepRelatedFileRows(props.selectedStep);
  const workflowFilesOffset = () => workflowRows().length;
  const promptRowsOffset = () => workflowFilesOffset() + workflowFileRows().length;
  const stepFileRowsOffset = () => promptRowsOffset() + promptRows().length;
  const configRowsOffset = () => stepFileRowsOffset() + stepFileRows().length;
  const workspaceRowsOffset = () => configRowsOffset() + (props.workflow.configuration?.fields.length ?? 0);
  const inputRows = () => props.selectedTriggerSummary
    ? triggerInputExampleLines(props.workflow, props.selectedTriggerSummary)
    : [];
  const inputRowsOffset = () => workspaceRowsOffset() + (props.workspaceFrame ? 6 : 0);
  const publishedRowsOffset = () => inputRowsOffset() + (props.selectedTriggerSummary ? visibleMetadataLineCount(inputRows()) : 0);
  const httpRows = () => props.selectedTriggerSummary ? publishedInputExampleLines(props.selectedTriggerSummary) : [];
  const showHttpRows = () => Boolean(props.selectedTriggerSummary?.publishedTrigger) &&
    props.selectedTriggerSummary !== undefined &&
    !metadataLinesEqual(inputRows(), httpRows());
  const httpRowsOffset = () => publishedRowsOffset() + (props.selectedTriggerSummary ? 5 : 0);
  const selectedRow = (index: number) => props.selectedMetadataRowIndex === index;
  const handleMouseUp = (event: TuiMouseEvent) => {
    if (!props.onOpenMetadataPopup) return;
    event.preventDefault();
    event.stopPropagation();
    props.onOpenMetadataPopup();
  };
  return (
    <box
      backgroundColor={THEME.backgroundAlt}
      border={["top", "right", "bottom", "left"]}
      borderColor={props.active ? THEME.borderActive : THEME.border}
      flexDirection="column"
      flexGrow={props.flexGrow ?? 1}
      minHeight={0}
      onMouseUp={handleMouseUp}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      width={props.width}
    >
      <scrollbox flexGrow={1} minHeight={0} stickyScroll={false}>
        <box flexDirection="column">
          <WorkflowOverviewSection
            rows={workflowRows()}
            selectedRowIndex={props.selectedMetadataRowIndex}
            onSelectRow={props.onSelectMetadataRow}
          />
          <WorkflowViewProtocolPanel mode={props.workflowViewProtocolMode} snapshot={props.workflowViewSnapshot} />
          <StepFilesSection
            rows={workflowFileRows()}
            selectedRowIndex={props.selectedMetadataRowIndex}
            selectionOffset={workflowFilesOffset()}
            title="WORKFLOW FILES"
            onOpenFile={props.onOpenPromptFile}
            onSelectRow={props.onSelectMetadataRow}
          />
          <StepPromptFilesSection
            selectionOffset={promptRowsOffset()}
            selectedRowIndex={props.selectedMetadataRowIndex}
            step={props.selectedStep}
            onOpenPromptFile={props.onOpenPromptFile}
            onSelectRow={props.onSelectMetadataRow}
          />
          <StepFilesSection
            rows={stepFileRows()}
            selectedRowIndex={props.selectedMetadataRowIndex}
            selectionOffset={stepFileRowsOffset()}
            title="STEP FILES"
            onOpenFile={props.onOpenPromptFile}
            onSelectRow={props.onSelectMetadataRow}
          />
          <Show when={(props.workflow.configuration?.fields.length ?? 0) > 0}>
            <MetadataSection
              rowCount={(props.workflow.configuration?.fields.length ?? 0) + 1}
              title="CONFIGURATION"
            >
              <ConfigMetadataHeader />
              <For each={props.workflow.configuration?.fields ?? []}>
                {(field, index) => {
                  const display = () => workflowConfigFieldDisplay(field, draftConfig(), props.configOverrides);
                  return (
                    <ConfigMetadataRow
                      fg={workflowConfigFieldMissing(field) ? THEME.warning : THEME.info}
                      label={field.label ?? field.id}
                      selected={selectedRow(configRowsOffset() + index())}
                      source={display().source}
                      value={display().value}
                      via={workflowConfigFieldVia(field)}
                      onEdit={() => props.onEditConfigValue(field)}
                      onSelect={() => props.onSelectMetadataRow?.(configRowsOffset() + index())}
                    />
                  );
                }}
              </For>
            </MetadataSection>
          </Show>
          <Show when={props.workspaceFrame}>
            {(frame) => (
              <MetadataSection rowCount={6} title="WORKSPACE" separated={true}>
                <MetadataRow
                  fg={workspaceStatusColor(frame().status)}
                  label="status"
                  selected={selectedRow(workspaceRowsOffset())}
                  value={frame().proposal
                    ? `${frame().proposal?.validation.ok ? "✓ " : "! "}proposal pending`
                    : `${frame().validation.ok ? "✓ " : "! "}${frame().status}`}
                />
                <MetadataRow label="patches" selected={selectedRow(workspaceRowsOffset() + 1)} value={String(frame().patches.length)} />
                <MetadataRow label="workspace graph" selected={selectedRow(workspaceRowsOffset() + 2)} value={workspaceGraphCompact(frame())} />
                <MetadataRow label="latest patch" selected={selectedRow(workspaceRowsOffset() + 3)} value={workspaceLatestPatchValue(frame())} />
                <MetadataRow
                  fg={workspaceLatestTestColor(frame())}
                  label="last test"
                  selected={selectedRow(workspaceRowsOffset() + 4)}
                  value={workspaceLatestTestValue(frame())}
                />
                <MetadataRow
                  fg={(frame().proposal?.validation ?? frame().validation).ok ? THEME.success : THEME.warning}
                  label="blocking issues"
                  selected={selectedRow(workspaceRowsOffset() + 5)}
                  value={workspaceIssueValue(frame())}
                />
              </MetadataSection>
            )}
          </Show>
          <Show when={props.selectedTriggerSummary}>
            {(summary) => {
              const inputExample = () => triggerInputExampleLines(props.workflow, summary());
              const httpBodyExample = () => publishedInputExampleLines(summary());
              const showHttpBodyExample = () =>
                Boolean(summary().publishedTrigger) && !metadataLinesEqual(inputExample(), httpBodyExample());
              return (
                <>
                  <MetadataLinesSection
                    lines={inputExample()}
                    selectedRowIndex={props.selectedMetadataRowIndex}
                    selectionOffset={inputRowsOffset()}
                    title="INPUT EXAMPLE"
                    onSelectRow={props.onSelectMetadataRow}
                  />
                  <MetadataSection rowCount={5} title="PUBLISHED TRIGGER" separated={true}>
                    <MetadataRow
                      fg={triggerPublicationColor(summary())}
                      label="status"
                      selected={selectedRow(publishedRowsOffset())}
                      value={triggerPublicationStatus(summary())}
                    />
                    <MetadataRow label="registry id" selected={selectedRow(publishedRowsOffset() + 1)} value={summary().publishedTrigger?.id ?? "-"} />
                    <MetadataRow label="endpoint" selected={selectedRow(publishedRowsOffset() + 2)} value={publishedTriggerEndpoint(summary().publishedTrigger)} />
                    <MetadataRow label="auth" selected={selectedRow(publishedRowsOffset() + 3)} value={summary().publishedTrigger?.auth?.mode ?? "-"} />
                    <MetadataRow label="input mode" selected={selectedRow(publishedRowsOffset() + 4)} value={summary().publishedTrigger?.input?.mode ?? "-"} />
                  </MetadataSection>
                  <Show when={showHttpBodyExample()}>
                    <MetadataLinesSection
                      lines={httpBodyExample()}
                      selectedRowIndex={props.selectedMetadataRowIndex}
                      selectionOffset={httpRowsOffset()}
                      title="HTTP BODY EXAMPLE"
                      onSelectRow={props.onSelectMetadataRow}
                    />
                  </Show>
                </>
              );
            }}
          </Show>
        </box>
      </scrollbox>
    </box>
  );
}

export function StartMetadataPopup(props: {
  configOverrides: Record<string, unknown>;
  inputDraft: string;
  selectedMetadataRowIndex: number;
  selectedStep?: WorkflowDesignNode;
  selectedTriggerSummary?: WorkflowTuiTriggerBoundarySummary;
  terminalHeight: number;
  terminalWidth: number;
  workflowViewProtocolMode?: WorkflowViewProtocolPanelMode;
  workflowViewSnapshot?: WorkflowViewSnapshot;
  workspaceFrame?: TuiWorkspaceFrame;
  workflow: WorkflowAppWorkflowDescriptor;
  onEditConfigValue(field: WorkflowConfigField): void;
  onOpenPromptFile(filePath: string): void;
  onSelectMetadataRow(index: number): void;
}) {
  const width = () => Math.min(Math.max(72, props.terminalWidth - 14), props.terminalWidth - 4);
  const height = () => Math.min(Math.max(16, props.terminalHeight - 6), props.terminalHeight - 2);
  const left = () => Math.max(2, Math.floor((props.terminalWidth - width()) / 2));
  const top = () => Math.max(1, Math.floor((props.terminalHeight - height()) / 2));
  return (
    <box
      backgroundColor={THEME.backgroundPanel}
      border={["top", "right", "bottom", "left"]}
      borderColor={THEME.borderActive}
      flexDirection="column"
      height={height()}
      left={left()}
      overflow="hidden"
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      position="absolute"
      top={top()}
      width={width()}
    >
      <box flexDirection="row" flexShrink={0} height={1}>
        <text fg={THEME.accent} flexGrow={1} height={1} truncate={true}>
          Workflow metadata
        </text>
        <text fg={THEME.muted} height={1} truncate={true}>
          up/down select · enter open · esc close
        </text>
      </box>
      <box flexGrow={1} minHeight={0} overflow="hidden" paddingTop={1}>
        <StartMetadataPanel
          active={true}
          configOverrides={props.configOverrides}
          inputDraft={props.inputDraft}
          selectedMetadataRowIndex={props.selectedMetadataRowIndex}
          selectedStep={props.selectedStep}
          selectedTriggerSummary={props.selectedTriggerSummary}
          workflowViewProtocolMode={props.workflowViewProtocolMode}
          workflowViewSnapshot={props.workflowViewSnapshot}
          workspaceFrame={props.workspaceFrame}
          workflow={props.workflow}
          onEditConfigValue={props.onEditConfigValue}
          onOpenPromptFile={props.onOpenPromptFile}
          onSelectMetadataRow={props.onSelectMetadataRow}
        />
      </box>
    </box>
  );
}

export function triggerPublicationStatus(summary: WorkflowTuiTriggerBoundarySummary) {
  if (summary.match === "exact") return "published";
  if (summary.match === "workflow") return "published for workflow";
  return "not published";
}

export function triggerPublicationColor(summary: WorkflowTuiTriggerBoundarySummary) {
  if (summary.match === "exact") return THEME.success;
  if (summary.match === "workflow") return THEME.warning;
  return THEME.muted;
}

export function publishedTriggerEndpoint(trigger?: TriggerDescriptor) {
  if (!trigger) return "-";
  return `${trigger.config?.method ?? "POST"} ${trigger.config?.path ?? `/api/triggers/${trigger.id}`}`;
}
