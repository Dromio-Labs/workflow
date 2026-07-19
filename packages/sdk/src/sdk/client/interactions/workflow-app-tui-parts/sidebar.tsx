/** @jsxImportSource @opentui/solid */
import { type WorkflowApp, type WorkflowAppRunOrigin, type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { type WorkflowRunSemanticRow, type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { providerModelSummary } from "./active-run-session.js";
import { activityDetails, activityTime, activityTypeLabel, flattenActivityChildren, runDurationText } from "./activity-table.js";
import { displayText, paintDisplaySpaces } from "./artifact-step-pages.js";
import { artifactDirectoryDisplay } from "./dialogs-popups.js";
import { sidebarPrimaryAction, sidebarSecondaryAction } from "./routing-keyboard.js";
import { truncate } from "./string-format.js";
import { LAYOUT, SIDEBAR_LABEL_WIDTH, THEME } from "./style.js";
import { type ShellRoute, type ShellStatus, type SidebarTab, type TuiArtifact, type TuiWorkspaceFrame } from "./types.js";
import { isSelectedArtifact, routeTitle, workflowDesignNodes } from "./workflow-design.js";
import * as path from "node:path";
import { For, Show } from "solid-js";
import { activityTimelineColor, activityTimelineDetailLines, activityTimelineGlyph, activityTimelineLabel } from "./sidebar-activity.js";
import { workspaceGraphCompact, workspaceLatestPatchCompact, workspaceLatestTestColor, workspaceLatestTestValue, workspacePatchCount, workspaceStatusColor } from "./sidebar-workspace.js";

export { workspaceStatusColor, workflowCanvasGraph, workflowUsesWorkspaceCanvas, workspaceIssueSummary, workspaceGraphSummary, workspaceGraphCompact, workspacePatchCount, workspaceLatestPatchSummary, workspaceLatestPatchCompact, workspaceLatestPatchValue, workspaceIssueValue, workspaceLatestTestValue, workspaceLatestTestColor, formatWorkspaceTestDuration } from "./sidebar-workspace.js";
export { activityTimelineGlyph, activityTimelineColor, activityTimelineLabel, activityTimelineDetailLines, activityTimelineModelLines, activityRowNeedsAnswer, activityRowIsCompletedModel, activityRowIsWorker, activityRowIsModelOrWorker } from "./sidebar-activity.js";


export function WorkflowSidebar(props: {
  app: WorkflowApp;
  artifacts: TuiArtifact[];
  result: string;
  runOrigin?: WorkflowAppRunOrigin;
  route: ShellRoute;
  selectedTab: SidebarTab;
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  status: ShellStatus;
  triggerCount: number;
  triggerJobCount: number;
  workspaceFrame?: TuiWorkspaceFrame;
  workflow: WorkflowAppWorkflowDescriptor;
  workflowCount: number;
  onSelectArtifact(artifactName: string): void;
  onSelectTab(tab: SidebarTab): void;
}) {
  return (
    <box
      alignSelf="stretch"
      backgroundColor={THEME.backgroundAlt}
      border={["left"]}
      borderColor={THEME.border}
      flexDirection="column"
      flexShrink={0}
      height="100%"
      overflow="hidden"
      paddingLeft={2}
      paddingRight={1}
      paddingTop={1}
      width={LAYOUT.sidebarWidth}
    >
      <SidebarTabs selectedTab={props.selectedTab} onSelectTab={props.onSelectTab} />
      <Show
        when={props.selectedTab === "activity"}
        fallback={
          <WorkflowSidebarConfig
            app={props.app}
            artifacts={props.artifacts}
            runOrigin={props.runOrigin}
            route={props.route}
            snapshot={props.snapshot}
            status={props.status}
            triggerCount={props.triggerCount}
            triggerJobCount={props.triggerJobCount}
            workspaceFrame={props.workspaceFrame}
            workflow={props.workflow}
            onSelectArtifact={props.onSelectArtifact}
          />
        }
      >
        <WorkflowSidebarActivity
          snapshot={props.snapshot}
          spinnerFrame={props.spinnerFrame}
          status={props.status}
        />
      </Show>
    </box>
  );
}

export function SidebarTabs(props: {
  selectedTab: SidebarTab;
  onSelectTab(tab: SidebarTab): void;
}) {
  return (
    <box flexDirection="row" flexShrink={0} height={1}>
      <SidebarTabButton
        active={props.selectedTab === "config"}
        label="CONFIG"
        onSelect={() => props.onSelectTab("config")}
      />
      <SidebarTabButton
        active={props.selectedTab === "activity"}
        label="ACTIVITY"
        onSelect={() => props.onSelectTab("activity")}
      />
    </box>
  );
}

export function SidebarTabButton(props: {
  active: boolean;
  label: string;
  onSelect(): void;
}) {
  return (
    <box
      backgroundColor={props.active ? THEME.selected : undefined}
      flexDirection="row"
      height={1}
      onMouseUp={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onSelect();
      }}
      paddingLeft={1}
      paddingRight={1}
      width={Math.floor((LAYOUT.sidebarWidth - 3) / 2)}
    >
      <text fg={props.active ? THEME.accent : THEME.muted} height={1} truncate={true}>
        {props.label}
      </text>
    </box>
  );
}

export function WorkflowSidebarConfig(props: {
  app: WorkflowApp;
  artifacts: TuiArtifact[];
  runOrigin?: WorkflowAppRunOrigin;
  route: ShellRoute;
  snapshot: WorkflowRunStoreSnapshot;
  status: ShellStatus;
  triggerCount: number;
  triggerJobCount: number;
  workspaceFrame?: TuiWorkspaceFrame;
  workflow: WorkflowAppWorkflowDescriptor;
  onSelectArtifact(artifactName: string): void;
}) {
  const graph = () => props.app.graph(props.workflow.id);
  const questionCount = () => props.snapshot.pendingQuestions.length;
  const scoreCount = () => props.snapshot.steps.filter((step) => typeof step.score === "number").length;
  const sidebarTextWidth = LAYOUT.sidebarWidth - 5;
  const sidebarValueWidth = sidebarTextWidth - SIDEBAR_LABEL_WIDTH;
  const currentStepText = () => props.snapshot.currentStep
    ? truncate(props.snapshot.currentStep.label, sidebarValueWidth)
    : "";
  const description = () => props.workflow.description
    ? truncate(props.workflow.description, sidebarTextWidth)
    : "";
  const workspaceErrors = () => {
    const frame = props.workspaceFrame;
    const validation = frame?.proposal?.validation ?? frame?.validation;
    return validation?.issues.filter((issue) => issue.severity === "error").length ?? 0;
  };
  return (
    <scrollbox flexGrow={1} minHeight={0} stickyScroll={false}>
      <box flexDirection="column">
        <SidebarLine fg={THEME.text} text={truncate(props.workflow.title, sidebarTextWidth)} />
        <Show when={description()}>
          {(value) => <SidebarLine fg={THEME.muted} text={value()} />}
        </Show>
        <SidebarSection title="Workflow" />
        <SidebarMetricRow label="graph" value={`${workflowDesignNodes(graph()).length} nodes · ${graph().nodes.length} steps`} />
        <SidebarMetricRow label="route" value={routeTitle(props.route)} />
        <SidebarMetricRow label="questions" value={`${questionCount()} pending`} />
        <Show when={props.triggerCount > 0 || props.triggerJobCount > 0}>
          <>
            <SidebarSection title="Triggers" />
            <SidebarMetricRow label="published" value={`${props.triggerCount}`} />
            <SidebarMetricRow label="jobs" value={`${props.triggerJobCount}`} />
          </>
        </Show>
        <Show when={props.workspaceFrame}>
          {(frame) => (
            <>
              <SidebarSection title="Workspace" />
              <SidebarMetricRow
                fg={workspaceStatusColor(frame().status)}
                label="status"
                value={frame().proposal ? "proposal pending" : frame().status}
              />
              <SidebarMetricRow
                label="patches"
                value={`${workspacePatchCount(frame())} · ${workspaceLatestPatchCompact(frame())}`}
              />
              <SidebarMetricRow
                label="graph"
                value={workspaceGraphCompact(frame())}
              />
              <SidebarMetricRow
                fg={workspaceLatestTestColor(frame())}
                label="last test"
                value={workspaceLatestTestValue(frame())}
              />
              <SidebarMetricRow
                fg={workspaceErrors() > 0 ? THEME.warning : THEME.success}
                label="issues"
                value={workspaceErrors() > 0 ? `${workspaceErrors()} blocking` : "none"}
              />
            </>
          )}
        </Show>
        <SidebarSection title="Run" />
        <SidebarMetricRow
          fg={props.status === "completed" ? THEME.success : props.status === "failed" ? THEME.error : props.status === "idle" ? THEME.muted : THEME.text}
          label="status"
          value={props.status}
        />
        <Show when={runDurationText(props.snapshot, props.status)}>
          {(duration) => <SidebarMetricRow fg={THEME.info} label="elapsed" value={duration()} />}
        </Show>
        <Show when={props.runOrigin}>
          {(origin) => <SidebarMetricRow fg={THEME.info} label="origin" value={origin().type} />}
        </Show>
        <Show when={currentStepText()}>
          {(value) => <SidebarMetricRow label="current" value={value()} />}
        </Show>
        <SidebarMetricRow label="scores" value={scoreCount() ? `${scoreCount()} gates` : "not run"} />
        <Show when={props.artifacts.length > 0}>
          <SidebarSection title="Artifacts" />
          <For each={props.artifacts.slice(0, 3)}>
            {(artifact) => (
              <SidebarLine
                fg={isSelectedArtifact(props.route, artifact) ? THEME.success : THEME.text}
                onMouseUp={() => props.onSelectArtifact(artifact.name)}
                text={truncate(artifact.name, sidebarTextWidth)}
              />
            )}
          </For>
          <SidebarLine fg={THEME.muted} text={truncate(artifactDirectoryDisplay(props.artifacts), sidebarTextWidth)} />
        </Show>
        <SidebarSection title="Keys" />
        <SidebarMetricRow label="primary" value={sidebarPrimaryAction(props.route, props.status)} />
        <SidebarLine fg={THEME.muted} text={sidebarSecondaryAction(props.route, props.status)} />
      </box>
    </scrollbox>
  );
}

export function WorkflowSidebarActivity(props: {
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  status: ShellStatus;
}) {
  const sidebarTextWidth = LAYOUT.sidebarWidth - 5;
  const rows = () => props.snapshot.transcript.slice(-24);
  const pendingQuestions = () => props.snapshot.pendingQuestions;
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <box flexDirection="column" flexShrink={0}>
        <SidebarLine fg={THEME.accent} text="LIVE ACTIVITY" />
        <Show when={runDurationText(props.snapshot, props.status)}>
          {(duration) => <SidebarLine fg={THEME.muted} text={duration()} />}
        </Show>
        <Show when={pendingQuestions().length > 0}>
          <box flexDirection="column" paddingTop={1}>
            <SidebarLine fg={THEME.warning} text="WAITING FOR ANSWERS" />
            <For each={pendingQuestions().slice(0, 3)}>
              {(question) => (
                <SidebarLine
                  fg={THEME.text}
                  text={truncate(`${question.id}: ${displayText(question.prompt)}`, sidebarTextWidth)}
                />
              )}
            </For>
          </box>
        </Show>
      </box>
      <scrollbox flexGrow={1} minHeight={0} stickyScroll={true} stickyStart="bottom">
        <Show when={rows().length > 0} fallback={<SidebarLine fg={THEME.muted} text="Waiting for workflow events..." />}>
          <ActivityTimeline
            rows={rows()}
            width={sidebarTextWidth}
          />
        </Show>
      </scrollbox>
    </box>
  );
}

export function ActivityTimeline(props: {
  rows: WorkflowRunSemanticRow[];
  width: number;
}) {
  return (
    <box flexDirection="column">
      <For each={props.rows}>
        {(row, index) => (
          <ActivityTimelineItem
            isLast={index() === props.rows.length - 1}
            row={row}
            width={props.width}
          />
        )}
      </For>
    </box>
  );
}

export function ActivityTimelineItem(props: {
  isLast: boolean;
  row: WorkflowRunSemanticRow;
  width: number;
}) {
  const contentWidth = () => Math.max(12, props.width - 3);
  const detailLines = () => activityTimelineDetailLines(props.row, contentWidth());
  const rail = () => props.isLast ? " " : "│";
  return (
    <box flexDirection="column" paddingTop={1}>
      <box flexDirection="row" height={1}>
        <text fg={activityTimelineColor(props.row)} height={1} truncate={true} width={2}>
          {activityTimelineGlyph(props.row)}
        </text>
        <text fg={THEME.muted} height={1} truncate={true} width={9}>
          {props.row.clockLabel || activityTime(props.row)}
        </text>
        <text fg={activityTimelineColor(props.row)} flexGrow={1} height={1} truncate={true}>
          {activityTimelineLabel(props.row)}
        </text>
      </box>
      <For each={detailLines()}>
        {(line) => (
          <ActivityTimelineDetailLine
            fg={line.primary ? THEME.text : THEME.muted}
            rail={rail()}
            text={line.text}
            width={contentWidth()}
          />
        )}
      </For>
    </box>
  );
}

export function ActivityTimelineDetailLine(props: {
  fg: string;
  rail: string;
  text: string;
  width: number;
}) {
  return (
    <box flexDirection="row" height={1}>
      <text fg={THEME.border} height={1} width={2}>
        {props.rail}
      </text>
      <text fg={props.fg} height={1} truncate={true} width={props.width}>
        {paintDisplaySpaces(props.text)}
      </text>
    </box>
  );
}

export function SidebarLine(props: {
  fg: string;
  onMouseUp?: () => void;
  text: number | string;
}) {
  return (
    <text fg={props.fg} height={1} onMouseUp={props.onMouseUp} truncate={true}>
      {props.text}
    </text>
  );
}

export function SidebarSection(props: {
  title: string;
}) {
  return (
    <>
      <SidebarLine fg={THEME.muted} text="" />
      <SidebarLine fg={THEME.accent} text={props.title} />
    </>
  );
}

export function SidebarMetricRow(props: {
  fg?: string;
  label: string;
  value: number | string;
}) {
  return (
    <box flexDirection="row" height={1}>
      <text fg={THEME.muted} height={1} truncate={true} width={SIDEBAR_LABEL_WIDTH}>
        {props.label}
      </text>
      <text fg={props.fg ?? THEME.text} flexGrow={1} height={1} truncate={true}>
        {props.value}
      </text>
    </box>
  );
}
