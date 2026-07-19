/** @jsxImportSource @opentui/solid */
import type { WorkflowViewSnapshot } from "@dromio/workflow-room-protocol";
import type { WorkflowAppRunOrigin, WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import type { WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import {
  runWorkflowDiagramViewportColumns,
  runWorkflowDiagramViewportRows,
  WorkflowGraphDiagramPane,
  WorkflowSnapshotDiagramPane,
} from "./diagram-view.js";
import { WorkflowRunProtocolRail } from "./run-protocol-rail.js";
import { RunTranscript } from "./run-transcript.js";
import { workflowCanvasGraph } from "./sidebar.js";
import { StepRail } from "./step-rail.js";
import type { TuiWorkspaceFrame, WorkflowViewProtocolPanelMode } from "./types.js";
import { Show } from "solid-js";

export function WorkflowRunPage(props: {
  error: string;
  origin?: WorkflowAppRunOrigin;
  result: string;
  selectedStepId?: string;
  showDiagramPane: boolean;
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  terminalHeight: number;
  terminalWidth: number;
  workspaceFrame?: TuiWorkspaceFrame;
  workflow: WorkflowAppWorkflowDescriptor;
  workflowViewProtocolMode?: WorkflowViewProtocolPanelMode;
  workflowRoomVisible: boolean;
  workflowViewSnapshot?: WorkflowViewSnapshot;
  onOpenActivityContent(title: string, content: string): void;
  onOpenResult(): void;
  onSelectStep(stepId: string): void;
}) {
  const workspaceCanvasGraph = () => props.snapshot.graph
    ? workflowCanvasGraph(props.workflow, props.workspaceFrame, props.snapshot.graph)
    : undefined;
  const showWorkspaceCanvas = () =>
    (props.workspaceFrame?.compiledGraph || props.workspaceFrame?.proposal?.compiledGraph) &&
    workspaceCanvasGraph() !== props.snapshot.graph;

  return (
    <box flexDirection="row" flexGrow={1} gap={1}>
      <StepRail
        selectedStepId={props.selectedStepId}
        snapshot={props.snapshot}
        spinnerFrame={props.spinnerFrame}
        onSelectStep={props.onSelectStep}
      />
      <Show
        when={props.showDiagramPane}
        fallback={
          <RunTranscript
            error={props.error}
            origin={props.origin}
            result={props.result}
            snapshot={props.snapshot}
            spinnerFrame={props.spinnerFrame}
            onOpenActivityContent={props.onOpenActivityContent}
            onOpenResult={props.onOpenResult}
          />
        }
      >
        <Show
          when={showWorkspaceCanvas() && workspaceCanvasGraph()}
          fallback={
            <WorkflowSnapshotDiagramPane
              selectedStepId={props.selectedStepId}
              snapshot={props.snapshot}
              spinnerFrame={props.spinnerFrame}
              viewportColumns={runWorkflowDiagramViewportColumns(props.terminalWidth)}
              viewportRows={runWorkflowDiagramViewportRows(props.terminalHeight)}
              onSelectStep={props.onSelectStep}
            />
          }
        >
          {(graph) => (
            <WorkflowGraphDiagramPane
              graph={graph()}
              selectedStepId={props.selectedStepId}
              spinnerFrame={props.spinnerFrame}
              viewportColumns={runWorkflowDiagramViewportColumns(props.terminalWidth)}
              viewportRows={runWorkflowDiagramViewportRows(props.terminalHeight)}
              workspaceFrame={props.workspaceFrame}
              workflow={props.workflow}
              onSelectStep={props.onSelectStep}
            />
          )}
        </Show>
      </Show>
      <WorkflowRunProtocolRail
        mode={props.workflowViewProtocolMode}
        snapshot={props.workflowViewSnapshot}
        terminalWidth={props.terminalWidth}
        visible={props.workflowRoomVisible}
      />
    </box>
  );
}
