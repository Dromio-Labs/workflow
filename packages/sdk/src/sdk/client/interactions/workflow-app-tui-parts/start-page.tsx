/** @jsxImportSource @opentui/solid */
import { type TriggerDescriptor } from "../../../workflow-control-plane/index.js";
import type { WorkflowViewSnapshot } from "@dromio/workflow-room-protocol";
import { workflowTuiTriggerBoundarySummary } from "../workflow-app-tui.js";
import { type WorkflowApp, type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { ActivityTable, runDurationText } from "./activity-table.js";
import { displayText, workflowDesignStepColor } from "./artifact-step-pages.js";
import { startWorkflowDiagramViewportColumns, startWorkflowDiagramViewportRows, WorkflowGraphDiagramPane } from "./diagram-view.js";
import { workflowCanvasGraph } from "./sidebar.js";
import { StartMetadataPanel } from "./start-metadata-panel.js";
import { truncate } from "./string-format.js";
import { THEME, WORKFLOW_DETAIL_PREVIEW_CHARS } from "./style.js";
import { type StartCenterTab, type StartPane, type TuiWorkspaceFrame, type WorkflowConfigField, type WorkflowViewProtocolPanelMode } from "./types.js";
import { startOutlineLine, workflowStartOutlineItems } from "./workflow-design.js";
import { type MouseEvent as TuiMouseEvent } from "@opentui/core";
import { For, Show } from "solid-js";

export function WorkflowStartPage(props: {
  activePane: StartPane;
  app: WorkflowApp;
  expandedStepIds: ReadonlySet<string>;
  inputDraft: string;
  selectedCenterTab: StartCenterTab;
  selectedMetadataPromptRowIndex: number;
  selectedStepId?: string;
  workflowViewProtocolMode?: WorkflowViewProtocolPanelMode;
  workflowViewSnapshot?: WorkflowViewSnapshot;
  showDiagramPane: boolean;
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  terminalHeight: number;
  terminalWidth: number;
  triggers: TriggerDescriptor[];
  workspaceFrame?: TuiWorkspaceFrame;
  workflow: WorkflowAppWorkflowDescriptor;
  configOverrides: Record<string, unknown>;
  onEditConfigValue(field: WorkflowConfigField): void;
  onOpenActivityContent(title: string, content: string): void;
  onOpenMetadataPopup(): void;
  onOpenPromptFile(filePath: string): void;
  onSelectCenterTab(tab: StartCenterTab): void;
  onSelectDiagramStep(stepId: string): void;
  onSelectStep(stepId: string): void;
}) {
  const graph = () =>
    workflowCanvasGraph(
      props.workflow,
      props.workspaceFrame,
      props.app.graph(props.workflow.id),
    );
  const outlineItems = () => workflowStartOutlineItems(graph(), props.expandedStepIds);
  const selectedDesignNode = () => outlineItems().find((item) => item.id === props.selectedStepId)?.node;
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
    <box backgroundColor={THEME.background} flexDirection="column" flexGrow={1}>
      <text fg={THEME.accent}>Start Workflow</text>
      <box flexDirection="row" flexGrow={1} gap={2}>
        <box
          backgroundColor={THEME.backgroundAlt}
          border={["top", "right", "bottom", "left"]}
          borderColor={props.activePane === "steps" ? THEME.borderActive : THEME.border}
          flexDirection="column"
          paddingBottom={1}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          width={38}
        >
          <text fg={props.activePane === "steps" ? THEME.accent : THEME.muted}>Steps</text>
          <scrollbox flexGrow={1} minHeight={0} stickyScroll={false}>
            <For each={outlineItems()}>
              {(item) => {
                const step = item.node;
                const selected = () => props.selectedStepId === item.id;
                return (
                  <box
                    backgroundColor={selected() ? THEME.selected : undefined}
                    flexDirection="column"
                    height={step.description ? 3 : 2}
                    onMouseUp={() => props.onSelectStep(item.id)}
                    paddingTop={1}
                  >
                    <text fg={workflowDesignStepColor(step, selected())} height={1} truncate={true}>
                      {startOutlineLine(item, selected())}
                    </text>
                    <Show when={step.description}>
                      {(description) => (
                        <text fg={THEME.muted} height={1} truncate={true}>
                          {`${"  ".repeat(item.depth + 1)}${truncate(displayText(description()), WORKFLOW_DETAIL_PREVIEW_CHARS)}`}
                        </text>
                      )}
                    </Show>
                  </box>
                );
              }}
            </For>
          </scrollbox>
        </box>
        <Show
          when={props.showDiagramPane}
          fallback={
            <StartMetadataPanel
              active={props.activePane === "metadata"}
              inputDraft={props.inputDraft}
              selectedMetadataRowIndex={props.selectedMetadataPromptRowIndex}
              selectedStep={selectedDesignNode()}
              selectedTriggerSummary={selectedTriggerSummary()}
              workflowViewProtocolMode={props.workflowViewProtocolMode}
              workflowViewSnapshot={props.workflowViewSnapshot}
              workspaceFrame={props.workspaceFrame}
              workflow={props.workflow}
              configOverrides={props.configOverrides}
              onEditConfigValue={props.onEditConfigValue}
              onOpenMetadataPopup={props.onOpenMetadataPopup}
              onOpenPromptFile={props.onOpenPromptFile}
            />
          }
        >
          <WorkflowStartCenterPane
            active={props.activePane === "canvas"}
            graph={graph()}
            selectedStepId={props.selectedStepId}
            selectedTab={props.selectedCenterTab}
            snapshot={props.snapshot}
            spinnerFrame={props.spinnerFrame}
            terminalHeight={props.terminalHeight}
            terminalWidth={props.terminalWidth}
            workspaceFrame={props.workspaceFrame}
            workflow={props.workflow}
            onOpenActivityContent={props.onOpenActivityContent}
            onSelectStep={props.onSelectDiagramStep}
            onSelectTab={props.onSelectCenterTab}
          />
          <StartMetadataPanel
            active={props.activePane === "metadata"}
            flexGrow={0}
            inputDraft={props.inputDraft}
            selectedMetadataRowIndex={props.selectedMetadataPromptRowIndex}
            selectedStep={selectedDesignNode()}
            selectedTriggerSummary={selectedTriggerSummary()}
            workflowViewProtocolMode={props.workflowViewProtocolMode}
            workflowViewSnapshot={props.workflowViewSnapshot}
            width={48}
            workspaceFrame={props.workspaceFrame}
            workflow={props.workflow}
            configOverrides={props.configOverrides}
            onEditConfigValue={props.onEditConfigValue}
            onOpenMetadataPopup={props.onOpenMetadataPopup}
            onOpenPromptFile={props.onOpenPromptFile}
          />
        </Show>
      </box>
    </box>
  );
}

export function WorkflowStartCenterPane(props: {
  active: boolean;
  graph: ReturnType<WorkflowApp["graph"]>;
  selectedStepId?: string;
  selectedTab: StartCenterTab;
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  terminalHeight: number;
  terminalWidth: number;
  workspaceFrame?: TuiWorkspaceFrame;
  workflow: WorkflowAppWorkflowDescriptor;
  onOpenActivityContent(title: string, content: string): void;
  onSelectStep(stepId: string): void;
  onSelectTab(tab: StartCenterTab): void;
}) {
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <box flexDirection="row" flexShrink={0} height={1}>
        <StartCenterTabButton
          active={props.selectedTab === "canvas"}
          label="Canvas"
          onSelect={() => props.onSelectTab("canvas")}
        />
        <text fg={THEME.muted} height={1} width={1}> </text>
        <StartCenterTabButton
          active={props.selectedTab === "activity"}
          label="Activity"
          onSelect={() => props.onSelectTab("activity")}
        />
      </box>
      <box flexGrow={1} minHeight={0} overflow="hidden">
        <Show
          when={props.selectedTab === "activity"}
          fallback={
            <WorkflowGraphDiagramPane
              active={props.active}
              graph={props.graph}
              selectedStepId={props.selectedStepId}
              spinnerFrame={props.spinnerFrame}
              viewportColumns={startWorkflowDiagramViewportColumns(props.terminalWidth)}
              viewportRows={startWorkflowDiagramViewportRows(props.terminalHeight)}
              workspaceFrame={props.workspaceFrame}
              workflow={props.workflow}
              onSelectStep={props.onSelectStep}
            />
          }
        >
          <WorkflowStartActivityPane
            snapshot={props.snapshot}
            spinnerFrame={props.spinnerFrame}
            onOpenActivityContent={props.onOpenActivityContent}
          />
        </Show>
      </box>
    </box>
  );
}

export function StartCenterTabButton(props: {
  active: boolean;
  label: string;
  onSelect(): void;
}) {
  const handleMouseUp = (event: TuiMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onSelect();
  };
  return (
    <box
      backgroundColor={props.active ? THEME.selected : undefined}
      flexDirection="row"
      height={1}
      onMouseUp={handleMouseUp}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={props.active ? THEME.accent : THEME.muted} height={1} truncate={true}>
        {props.label}
      </text>
    </box>
  );
}

export function WorkflowStartActivityPane(props: {
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  onOpenActivityContent(title: string, content: string): void;
}) {
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <text fg={THEME.muted} flexShrink={0} height={1} truncate={true}>
        {["Activity", runDurationText(props.snapshot, props.snapshot.status)].filter(Boolean).join(" · ")}
      </text>
      <scrollbox flexGrow={1} minHeight={0} stickyScroll={true}>
        <ActivityTable
          emptyText="No workflow activity yet."
          rows={props.snapshot.transcript}
          spinnerFrame={props.spinnerFrame}
          onOpenRowContent={props.onOpenActivityContent}
        />
      </scrollbox>
    </box>
  );
}
