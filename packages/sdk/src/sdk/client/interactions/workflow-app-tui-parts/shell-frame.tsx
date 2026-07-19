/** @jsxImportSource @opentui/solid */
import { type TriggerDescriptor, type TriggerJobSnapshot } from "../../../workflow-control-plane/index.js";
import type { WorkflowViewSnapshot } from "@dromio/workflow-room-protocol";
import { type WorkflowApp, type WorkflowAppRunOrigin, type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { WorkflowArtifactPage, WorkflowStepDetailPage, type WorkflowStepDetailTarget } from "./artifact-step-pages.js";
import { resultArtifactName } from "./dialogs-popups.js";
import { WorkflowLibraryPage } from "./library-view.js";
import { headerHelp } from "./routing-keyboard.js";
import { WorkflowRunPage } from "./run-pages.js";
import { WorkflowStartPage } from "./start-page.js";
import { truncate } from "./string-format.js";
import { THEME } from "./style.js";
import { TriggerFirePage, TriggerJobsPage, TriggerRegistryPage } from "./trigger-pages.js";
import { type ShellRoute, type ShellStatus, type StartCenterTab, type StartPane, type TuiArtifact, type TuiWorkspaceFrame, type WorkflowConfigField, type WorkflowLibraryAppListing, type WorkflowLibraryViewMode, type WorkflowViewProtocolPanelMode } from "./types.js";
import { artifactWorkflowId, routeBreadcrumb, workflowDescriptor } from "./workflow-design.js";
import { type CliRenderer } from "@opentui/core";
import { Match, Show, Switch } from "solid-js";

export function clearTerminalSurface(renderer: CliRenderer) {
  const internal = renderer as unknown as {
    forceFullRepaintRequested?: boolean;
    requestRender?(): void;
  };
  internal.forceFullRepaintRequested = true;
  internal.requestRender?.();
}

export function ShellHeader(props: {
  appTitle: string;
  commandName: string;
  compact?: boolean;
  leaderActive?: boolean;
  runMeta?: string;
  route: ShellRoute;
  status: ShellStatus;
  workflow: WorkflowAppWorkflowDescriptor;
  workflowCount: number;
}) {
  const help = () => headerHelp(props.route, props.status);
  const accent = () => props.leaderActive ? THEME.muted : THEME.accent;
  return (
    <box flexDirection="column" flexShrink={0} paddingBottom={props.compact ? 0 : 1}>
      <box flexDirection="row" height={1}>
        <text fg={props.leaderActive ? THEME.muted : THEME.text} flexGrow={1} height={1} truncate={true}>
          {props.commandName} · {props.appTitle} · {props.status}
        </text>
        <Show when={props.runMeta}>
          {(runMeta) => (
            <text fg={THEME.muted} height={1} truncate={true}>
              {runMeta()}
            </text>
          )}
        </Show>
      </box>
      <text fg={accent()} height={1} truncate={true}>
        {routeBreadcrumb(props.route, props.workflow)}
      </text>
      <Show when={!props.compact && help()}>
        {(value) => (
          <text fg={THEME.muted} height={1} truncate={true}>
            {value()}
          </text>
        )}
      </Show>
    </box>
  );
}

export function ShellMain(props: {
  app: WorkflowApp;
  artifacts: TuiArtifact[];
  detailCollapsedStepIds: ReadonlySet<string>;
  error: string;
  expandedStartStepIds: ReadonlySet<string>;
  inputDraft: string;
  libraryExportMode: boolean;
  libraryExportSelection: ReadonlySet<string>;
  result: string;
  route: ShellRoute;
  runOrigin?: WorkflowAppRunOrigin;
  selectedJob?: TriggerJobSnapshot;
  selectedMetadataPromptRowIndex: number;
  selectedStartCenterTab: StartCenterTab;
  selectedStartPane: StartPane;
  selectedStartStepId?: string;
  selectedTrigger?: TriggerDescriptor;
  selectedWorkflowId: string;
  workflowViewProtocolMode?: WorkflowViewProtocolPanelMode;
  workflowRoomVisible: boolean;
  workflowViewSnapshot?: WorkflowViewSnapshot;
  snapshot: WorkflowRunStoreSnapshot;
  showDiagramPane: boolean;
  spinnerFrame: number;
  status: ShellStatus;
  terminalHeight: number;
  terminalWidth: number;
  triggerJobs: TriggerJobSnapshot[];
  triggers: TriggerDescriptor[];
  workspaceFrame?: TuiWorkspaceFrame;
  workflows: WorkflowAppWorkflowDescriptor[];
  appListings: WorkflowLibraryAppListing[];
  configOverridesByWorkflow: Record<string, Record<string, unknown>>;
  libraryViewMode: WorkflowLibraryViewMode;
  onEditConfigValue(field: WorkflowConfigField): void;
  onFireTrigger(trigger: TriggerDescriptor): void;
  onOpenActivityContent(title: string, content: string): void;
  onOpenMetadataPopup(): void;
  onOpenPromptFile(filePath: string): void;
  onOpenResult(): void;
  onOpenStepData(step: WorkflowStepDetailTarget): void;
  onRefreshTriggers(): void | Promise<void>;
  onSelectJob(jobId: string): void;
  onSelectStartCenterTab(tab: StartCenterTab): void;
  onSelectStartStep(stepId: string): void;
  onSelectWorkflow(workflowId: string): void;
  onSelectStep(stepId: string): void;
  onSelectTrigger(triggerId: string): void;
  onStartWorkflow(workflowId: string): void;
  onToggleDetailStepCollapsed(stepId: string): void;
  onToggleWorkflowExportSelection(workflowId: string): void;
}) {
  const selectedStepId = () => props.route.type === "step" ? props.route.stepId : undefined;
  const selectedArtifactName = () => props.route.type === "artifact" ? props.route.artifactName : undefined;
  return (
    <Switch>
      <Match when={props.route.type === "library"}>
        <WorkflowLibraryPage
          app={props.app}
          appListings={props.appListings}
          libraryViewMode={props.libraryViewMode}
          exportMode={props.libraryExportMode}
          exportSelection={props.libraryExportSelection}
          selectedWorkflowId={props.selectedWorkflowId}
          workflows={props.workflows}
          compact={props.terminalHeight < 18}
          onSelectWorkflow={props.onSelectWorkflow}
          onStartWorkflow={props.onStartWorkflow}
          onToggleExportSelection={props.onToggleWorkflowExportSelection}
        />
      </Match>
      <Match when={props.route.type === "start"}>
        <WorkflowStartPage
          app={props.app}
          activePane={props.selectedStartPane}
          expandedStepIds={props.expandedStartStepIds}
          inputDraft={props.inputDraft}
          selectedCenterTab={props.selectedStartCenterTab}
          selectedMetadataPromptRowIndex={props.selectedMetadataPromptRowIndex}
          selectedStepId={props.selectedStartStepId}
          workflowViewProtocolMode={props.workflowViewProtocolMode}
          workflowViewSnapshot={props.workflowViewSnapshot}
          snapshot={props.snapshot}
          spinnerFrame={props.spinnerFrame}
          terminalHeight={props.terminalHeight}
          terminalWidth={props.terminalWidth}
          triggers={props.triggers}
          workspaceFrame={props.workspaceFrame}
          workflow={workflowDescriptor(props.workflows, props.selectedWorkflowId)}
          configOverrides={props.configOverridesByWorkflow[props.selectedWorkflowId] ?? {}}
          showDiagramPane={props.showDiagramPane}
          onEditConfigValue={props.onEditConfigValue}
          onOpenMetadataPopup={props.onOpenMetadataPopup}
          onOpenPromptFile={props.onOpenPromptFile}
          onOpenActivityContent={props.onOpenActivityContent}
          onSelectCenterTab={props.onSelectStartCenterTab}
          onSelectDiagramStep={props.onSelectStartStep}
          onSelectStep={props.onSelectStep}
        />
      </Match>
      <Match when={props.route.type === "triggers"}>
        <TriggerRegistryPage
          jobs={props.triggerJobs}
          selectedTrigger={props.selectedTrigger}
          triggers={props.triggers}
          onFireTrigger={props.onFireTrigger}
          onRefresh={props.onRefreshTriggers}
          onSelectTrigger={props.onSelectTrigger}
        />
      </Match>
      <Match when={props.route.type === "triggerFire"}>
        <TriggerFirePage
          trigger={props.selectedTrigger ?? props.triggers.find((trigger) => props.route.type === "triggerFire" && trigger.id === props.route.triggerId)}
        />
      </Match>
      <Match when={props.route.type === "triggerJobs"}>
        <TriggerJobsPage
          jobs={props.triggerJobs}
          selectedJob={props.selectedJob}
          onRefresh={props.onRefreshTriggers}
          onSelectJob={props.onSelectJob}
        />
      </Match>
      <Match when={props.route.type === "artifact"}>
        <WorkflowArtifactPage
          artifacts={props.artifacts}
          artifactName={resultArtifactName(props.app, artifactWorkflowId(props.route, props.selectedWorkflowId))}
          error={props.error}
          result={props.result}
          selectedArtifactName={selectedArtifactName()}
          selectedStepId={selectedStepId()}
          snapshot={props.snapshot}
          spinnerFrame={props.spinnerFrame}
          onSelectStep={props.onSelectStep}
        />
      </Match>
      <Match when={props.route.type === "run"}>
        <WorkflowRunPage
          error={props.error}
          origin={props.runOrigin}
          result={props.result}
          selectedStepId={selectedStepId()}
          showDiagramPane={props.showDiagramPane}
          snapshot={props.snapshot}
          spinnerFrame={props.spinnerFrame}
          terminalHeight={props.terminalHeight}
          terminalWidth={props.terminalWidth}
          workspaceFrame={props.workspaceFrame}
          workflow={workflowDescriptor(props.workflows, props.selectedWorkflowId)}
          workflowViewProtocolMode={props.workflowViewProtocolMode}
          workflowRoomVisible={props.workflowRoomVisible}
          workflowViewSnapshot={props.workflowViewSnapshot}
          onOpenActivityContent={props.onOpenActivityContent}
          onOpenResult={props.onOpenResult}
          onSelectStep={props.onSelectStep}
        />
      </Match>
      <Match when={props.route.type === "step"}>
        <WorkflowStepDetailPage
          app={props.app}
          collapsedStepIds={props.detailCollapsedStepIds}
          inputDraft={props.inputDraft}
          selectedStepId={selectedStepId()}
          snapshot={props.snapshot}
          spinnerFrame={props.spinnerFrame}
          triggers={props.triggers}
          workflow={workflowDescriptor(props.workflows, props.route.type === "step" ? props.route.workflowId : props.selectedWorkflowId)}
          onOpenActivityContent={props.onOpenActivityContent}
          onSelectStep={props.onSelectStep}
          onOpenStepData={props.onOpenStepData}
          onToggleStepCollapsed={props.onToggleDetailStepCollapsed}
        />
      </Match>
    </Switch>
  );
}
