/** @jsxImportSource @opentui/solid */
import { type WorkflowApp, type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { projectWorkflowDiagram, projectWorkflowGraphDiagram, workflowWorkspacePatchPreview } from "../workflow-diagram.js";
import {
  installWorkflowOpenTuiMermanRenderer,
  workflowOpenTuiMermanRenderer,
} from "../workflow-opentui-merman-renderer.js";
import { type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { clampNumber } from "./command-palette.js";
import { workflowUsesWorkspaceCanvas } from "./sidebar.js";
import { STEP_RAIL_WIDTH } from "./step-rail.js";
import { truncate } from "./string-format.js";
import { DIAGRAM_SCROLL_HORIZONTAL_CONTEXT, DIAGRAM_SCROLL_VERTICAL_CONTEXT, LAYOUT, THEME } from "./style.js";
import { type TuiWorkspaceFrame } from "./types.js";
import { type MouseEvent as TuiMouseEvent } from "@opentui/core";
import { extend } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";

installWorkflowOpenTuiMermanRenderer(extend);

export function WorkflowGraphDiagramPane(props: {
  active?: boolean;
  framed?: boolean;
  graph: ReturnType<WorkflowApp["graph"]>;
  selectedStepId?: string;
  showHeader?: boolean;
  spinnerFrame: number;
  viewportColumns?: number;
  viewportRows?: number;
  workspaceFrame?: TuiWorkspaceFrame;
  workflow?: WorkflowAppWorkflowDescriptor;
  onSelectStep?(stepId: string): void;
}) {
  const usesWorkspace = () =>
    props.workflow && workflowUsesWorkspaceCanvas(props.workflow, props.workspaceFrame);
  const projection = createMemo(() =>
    projectWorkflowGraphDiagram({
      graph: props.graph,
      patchPreview: usesWorkspace() ? workflowWorkspacePatchPreview(props.workspaceFrame) : undefined,
      selectedStepId: props.selectedStepId,
    })
  );
  return (
    <WorkflowDiagramPane
      active={props.active}
      projection={projection()}
      spinnerFrame={props.spinnerFrame}
      title={usesWorkspace() ? "Draft Workflow Canvas" : "Workflow Canvas"}
      viewportColumns={props.viewportColumns}
      viewportRows={props.viewportRows}
      framed={props.framed}
      showHeader={props.showHeader}
      onSelectStep={props.onSelectStep}
    />
  );
}

export function WorkflowDiagramPopup(props: {
  graph: ReturnType<WorkflowApp["graph"]>;
  terminalHeight: number;
  terminalWidth: number;
  workflow: WorkflowAppWorkflowDescriptor;
}) {
  const width = () => Math.max(44, props.terminalWidth - 4);
  const height = () => Math.max(14, props.terminalHeight - 4);
  const left = () => Math.max(2, Math.floor((props.terminalWidth - width()) / 2));
  const top = () => Math.max(1, Math.floor((props.terminalHeight - height()) / 2));
  const projection = createMemo(() =>
    projectWorkflowGraphDiagram({
      graph: props.graph,
    })
  );
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
      <box flexDirection="row" height={1}>
        <text fg={THEME.accent} flexGrow={1} height={1} truncate={true}>
          {props.workflow.title}
        </text>
        <text fg={THEME.muted} height={1} truncate={true}>
          tab close · esc close · enter start
        </text>
      </box>
      <box flexGrow={1} marginTop={1} minHeight={0} overflow="hidden">
        <WorkflowDiagramPane
          active={false}
          projection={projection()}
          spinnerFrame={0}
          title="Workflow Diagram"
          viewportColumns={Math.max(24, width() - 8)}
          viewportRows={Math.max(4, height() - 8)}
        />
      </box>
    </box>
  );
}

export function WorkflowSnapshotDiagramPane(props: {
  framed?: boolean;
  selectedStepId?: string;
  showHeader?: boolean;
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  viewportColumns?: number;
  viewportRows?: number;
  onSelectStep?(stepId: string): void;
}) {
  const projection = createMemo(() =>
    projectWorkflowDiagram({
      selectedStepId: props.selectedStepId,
      snapshot: props.snapshot,
    })
  );
  return (
    <WorkflowDiagramPane
      active={false}
      projection={projection()}
      spinnerFrame={props.spinnerFrame}
      title="Workflow Canvas"
      viewportColumns={props.viewportColumns}
      viewportRows={props.viewportRows}
      framed={props.framed}
      showHeader={props.showHeader}
      onSelectStep={props.onSelectStep}
    />
  );
}

export function WorkflowDiagramPane(props: {
  active?: boolean;
  framed?: boolean;
  projection: ReturnType<typeof projectWorkflowDiagram>;
  showHeader?: boolean;
  spinnerFrame: number;
  title: string;
  viewportColumns?: number;
  viewportRows?: number;
  onSelectStep?(stepId: string): void;
}) {
  const targetScroll = createMemo(() => workflowDiagramActiveNodeScroll(
    props.projection,
    props.spinnerFrame,
    props.viewportColumns,
    props.viewportRows,
  ));
  const [diagramScroll, setDiagramScroll] = createSignal(targetScroll());
  let scrollAnimationTimer: ReturnType<typeof setInterval> | undefined;
  const clearScrollAnimation = () => {
    if (!scrollAnimationTimer) return;
    clearInterval(scrollAnimationTimer);
    scrollAnimationTimer = undefined;
  };
  createEffect(() => {
    const target = targetScroll();
    const from = untrack(diagramScroll);
    if (from.x === target.x && from.y === target.y) return;
    clearScrollAnimation();
    const startedAt = Date.now();
    scrollAnimationTimer = setInterval(() => {
      const progress = clampNumber((Date.now() - startedAt) / DIAGRAM_SCROLL_ANIMATION_MS, 0, 1);
      const eased = easeOutCubic(progress);
      const next = {
        x: Math.max(0, Math.round(from.x + (target.x - from.x) * eased)),
        y: Math.max(0, Math.round(from.y + (target.y - from.y) * eased)),
      };
      setDiagramScroll(next);
      if (progress >= 1) {
        setDiagramScroll(target);
        clearScrollAnimation();
      }
    }, DIAGRAM_SCROLL_ANIMATION_FRAME_MS);
    if (typeof scrollAnimationTimer === "object" && "unref" in scrollAnimationTimer) scrollAnimationTimer.unref();
  });
  onCleanup(clearScrollAnimation);
  const hitTargets = createMemo(() => workflowDiagramHitTargets(props.projection, props.spinnerFrame));
  const renderPlan = createMemo(() =>
    workflowOpenTuiMermanRenderer.renderProjection(props.projection, {
      activeEdgeProgress: props.projection.activeEdge ? (props.spinnerFrame % 20) / 20 : undefined,
    })
  );
  const framed = () => props.framed !== false;
  const showHeader = () => props.showHeader !== false;
  const handleMouseUp = (event: TuiMouseEvent) => {
    if (!props.onSelectStep) return;
    const origin = event.target ?? event.source;
    if (!origin) return;
    const contentX = Math.floor(event.x - origin.x + diagramScroll().x);
    const contentY = Math.floor(event.y - origin.y + diagramScroll().y);
    const target = hitTargets().find((item) =>
      contentX >= item.x &&
      contentX < item.x + item.width &&
      contentY >= item.y &&
      contentY < item.y + item.height
    );
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    props.onSelectStep(target.stepId);
  };
  return (
    <box backgroundColor={THEME.background} flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <Show when={showHeader()}>
        <box backgroundColor={THEME.background} flexDirection="row" height={1}>
          <text fg={props.active ? THEME.accent : THEME.muted} height={1} truncate={true} width={22}>{props.title}</text>
          <text fg={THEME.muted} flexGrow={1} height={1} truncate={true}>
            {props.active
              ? "canvas focus · ↑↓ select · ←→ tabs · enter inspect"
              : `${workflowOpenTuiMermanRenderer.engine} · select a step from the outline to inspect`}
          </text>
        </box>
      </Show>
      <box
        backgroundColor={THEME.background}
        border={framed() ? ["top", "right", "bottom", "left"] : undefined}
        borderColor={props.active ? THEME.borderActive : THEME.border}
        flexDirection="column"
        flexGrow={1}
        marginTop={showHeader() ? 1 : 0}
        minHeight={0}
        overflow="hidden"
        paddingBottom={framed() ? 1 : 0}
        paddingLeft={framed() ? 1 : 0}
        paddingRight={framed() ? 1 : 0}
        paddingTop={framed() ? 1 : 0}
      >
        <workflow_flowchart
          activeEdge={renderPlan().activeEdge}
          activeEdgeColor={THEME.info}
          activeEdgeProgress={renderPlan().activeEdgeProgress}
          activeNode={renderPlan().activeNode}
          activeNodeColor={THEME.accent}
          alignSelf="center"
          backgroundColor={THEME.background}
          content={renderPlan().content}
          edgeColor={THEME.border}
          flexGrow={1}
          groupColor={THEME.borderActive}
          labelColor={THEME.info}
          minHeight={0}
          minNodeGap={renderPlan().minNodeGap}
          minRankGap={renderPlan().minRankGap}
          nodeBgColors={renderPlan().nodeBgColors}
          nodeColor={THEME.text}
          nodeColors={renderPlan().nodeColors}
          onMouseUp={handleMouseUp}
          overflow="hidden"
          pulseColor={THEME.info}
          pulseFrame={props.spinnerFrame}
          scrollX={diagramScroll().x}
          scrollY={diagramScroll().y}
        />
      </box>
    </box>
  );
}

export function workflowDiagramActiveNodeScroll(
  projection: ReturnType<typeof projectWorkflowDiagram>,
  spinnerFrame: number,
  viewportColumns = DIAGRAM_SCROLL_HORIZONTAL_CONTEXT * 2,
  viewportRows = DIAGRAM_SCROLL_VERTICAL_CONTEXT * 2,
) {
  if (!projection.activeNode) return { x: 0, y: 0 };
  try {
    const diagram = workflowOpenTuiMermanRenderer.parse(projection.content);
    const activeLabel = diagram.nodes.find((node) => node.id === projection.activeNode)?.label;
    const labelLines = diagramLabelSearchLines(activeLabel);
    if (labelLines.length === 0) return { x: 0, y: 0 };
    const anchor = labelLines[0]!;
    const rendered = renderPlainWorkflowDiagram(projection, spinnerFrame);
    for (const [lineIndex, line] of rendered.split("\n").entries()) {
      const column = line.indexOf(anchor);
      if (column >= 0) {
        const labelWidth = Math.max(...labelLines.map((labelLine) => labelLine.length));
        return {
          x: Math.max(0, Math.floor(column + labelWidth / 2 - viewportColumns / 2)),
          y: Math.max(0, Math.floor(lineIndex - viewportRows / 2)),
        };
      }
    }
  } catch {
    return { x: 0, y: 0 };
  }
  return { x: 0, y: 0 };
}

export type WorkflowDiagramHitTarget = {
  height: number;
  stepId: string;
  width: number;
  x: number;
  y: number;
};

export function workflowDiagramHitTargets(
  projection: ReturnType<typeof projectWorkflowDiagram>,
  spinnerFrame: number,
): WorkflowDiagramHitTarget[] {
  try {
    const diagram = workflowOpenTuiMermanRenderer.parse(projection.content);
    const renderedLines = renderPlainWorkflowDiagram(projection, spinnerFrame).split("\n");
    const targets: WorkflowDiagramHitTarget[] = [];
    for (const node of diagram.nodes) {
      const stepId = projection.stepIdByNodeId[node.id];
      if (!stepId) continue;
      const labelLines = diagramLabelSearchLines(node.label);
      const bounds = diagramLabelBounds(renderedLines, labelLines);
      if (!bounds) continue;
      targets.push({
        height: bounds.height + 2,
        stepId,
        width: bounds.width + 4,
        x: Math.max(0, bounds.x - 2),
        y: Math.max(0, bounds.y - 1),
      });
    }
    return targets;
  } catch {
    return [];
  }
}

export function renderPlainWorkflowDiagram(
  projection: ReturnType<typeof projectWorkflowDiagram>,
  spinnerFrame: number,
) {
  return workflowOpenTuiMermanRenderer.renderPlainProjection(projection, {
    activeEdgeProgress: projection.activeEdge ? (spinnerFrame % 20) / 20 : undefined,
  });
}

export const DIAGRAM_SCROLL_ANIMATION_FRAME_MS = 16;

export const DIAGRAM_SCROLL_ANIMATION_MS = 180;

export function easeOutCubic(value: number) {
  const clamped = clampNumber(value, 0, 1);
  return 1 - (1 - clamped) ** 3;
}

export function startWorkflowDiagramViewportColumns(terminalWidth: number) {
  return Math.max(24, terminalWidth - LAYOUT.shellPaddingLeft - LAYOUT.shellPaddingRight - 38 - 48 - 8);
}

export function startWorkflowDiagramViewportRows(terminalHeight: number) {
  return Math.max(4, terminalHeight - LAYOUT.shellPaddingTop - LAYOUT.shellPaddingBottom - 13);
}

export function runWorkflowDiagramViewportColumns(terminalWidth: number) {
  return Math.max(24, terminalWidth - LAYOUT.shellPaddingLeft - LAYOUT.shellPaddingRight - STEP_RAIL_WIDTH - 7);
}

export function runWorkflowDiagramViewportRows(terminalHeight: number) {
  return Math.max(4, terminalHeight - LAYOUT.shellPaddingTop - LAYOUT.shellPaddingBottom - 8);
}

export function diagramLabelSearchLines(label: string | undefined) {
  return (label ?? "")
    .replace(/\s*<br\s*\/?>\s*/gi, "\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function diagramLabelBounds(lines: string[], searches: string[]) {
  if (searches.length === 0) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (const search of searches) {
    let matched = false;
    for (const [lineIndex, line] of lines.entries()) {
      const column = line.indexOf(search);
      if (column < 0) continue;
      matched = true;
      minX = Math.min(minX, column);
      minY = Math.min(minY, lineIndex);
      maxX = Math.max(maxX, column + search.length);
      maxY = Math.max(maxY, lineIndex + 1);
      break;
    }
    if (!matched) return undefined;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return undefined;
  return {
    height: Math.max(1, maxY - minY),
    width: Math.max(1, maxX - minX),
    x: minX,
    y: minY,
  };
}

export function firstSearchLineColumn(line: string, searches: string[]) {
  let column = -1;
  for (const search of searches) {
    const index = line.indexOf(search);
    if (index >= 0) column = column < 0 ? index : Math.min(column, index);
  }
  return column;
}
