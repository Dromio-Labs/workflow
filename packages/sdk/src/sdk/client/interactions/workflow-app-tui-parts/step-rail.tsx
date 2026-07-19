/** @jsxImportSource @opentui/solid */
import { type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { activityIndexColor } from "./activity-table.js";
import { boundaryStepColor, displayText, formatStepIndex, nestedStepRows, type NestedWorkflowStepRow, rowMatchesNestedStep, stepRailStatusLine, workflowStepDisplayLabel, workflowStepExecutionBadge } from "./artifact-step-pages.js";
import { spinnerGlyph, statusGlyph, stepSpins, stepStatusColor } from "./routing-keyboard.js";
import { truncate, truncateToWidth } from "./string-format.js";
import { THEME } from "./style.js";
import { type MouseEvent as TuiMouseEvent } from "@opentui/core";
import { createSignal, For, Show } from "solid-js";

export const STEP_RAIL_WIDTH = 35;

export const STEP_RAIL_CONTENT_WIDTH = STEP_RAIL_WIDTH - 1;

export function stepRailLine(prefix: string, label: string) {
  const labelWidth = Math.max(0, STEP_RAIL_CONTENT_WIDTH - prefix.length);
  return `${prefix}${truncateToWidth(displayText(label), labelWidth)}`;
}

export function stepRailTextLine(value: string) {
  return truncateToWidth(value, STEP_RAIL_CONTENT_WIDTH);
}

export type StepRailChildRenderItem =
  | { child: NestedWorkflowStepRow; isLast: boolean; kind: "step" }
  | { isLast: boolean; kind: "loop"; loopId: string; rows: NestedWorkflowStepRow[] };

export type StepRailChildRenderDraft =
  | { child: NestedWorkflowStepRow; kind: "step" }
  | { kind: "loop"; loopId: string; rows: NestedWorkflowStepRow[] };

export function stepRailChildItems(children: NestedWorkflowStepRow[]): StepRailChildRenderItem[] {
  const items: StepRailChildRenderDraft[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child?.loop) {
      if (child) items.push({ child, kind: "step" });
      continue;
    }
    const loopId = child.loop.id;
    const rows: NestedWorkflowStepRow[] = [];
    while (index < children.length && children[index]?.loop?.id === loopId) {
      rows.push(children[index]!);
      index += 1;
    }
    index -= 1;
    items.push({ kind: "loop", loopId, rows });
  }
  return items.map((item, index) => ({ ...item, isLast: index === items.length - 1 } as StepRailChildRenderItem));
}

export function stepRailLoopRange(rows: NestedWorkflowStepRow[]) {
  const first = rows[0]?.indexLabel;
  const last = rows.at(-1)?.indexLabel;
  if (!first) return "";
  return first === last || !last ? first : `${first}-${last}`;
}

export function stepRailLoopBadge(step: WorkflowRunStoreSnapshot["steps"][number]) {
  const badge = workflowStepExecutionBadge(step);
  const normalized = badge.toLowerCase();
  if (normalized.startsWith("for each ")) return `per ${badge.slice("for each ".length)}`;
  return badge || "loop";
}

export function latestLoopIterationRow(
  snapshot: WorkflowRunStoreSnapshot,
  parentStepId: string,
  rows: NestedWorkflowStepRow[],
) {
  for (let index = snapshot.transcript.length - 1; index >= 0; index -= 1) {
    const row = snapshot.transcript[index];
    if (!row || row.parentStepId !== parentStepId) continue;
    if (!rows.some((nested) => rowMatchesNestedStep(row, nested))) continue;
    if (row.iterationLabel || typeof row.iterationIndex === "number" || typeof row.iterationTotal === "number") {
      return row;
    }
  }
  return undefined;
}

export function stepRailLoopIterationLine(
  snapshot: WorkflowRunStoreSnapshot,
  parentStep: WorkflowRunStoreSnapshot["steps"][number],
  rows: NestedWorkflowStepRow[],
  trunk: string,
) {
  const iteration = latestLoopIterationRow(snapshot, parentStep.id, rows);
  if (!iteration) return "";
  const parts: string[] = [];
  if (iteration.iterationLabel) parts.push(displayText(iteration.iterationLabel));
  if (typeof iteration.iterationIndex === "number") {
    const current = iteration.iterationIndex + 1;
    parts.push(typeof iteration.iterationTotal === "number" ? `${current}/${iteration.iterationTotal}` : `#${current}`);
  }
  return parts.length > 0 ? stepRailTextLine(`  ${trunk} item ${parts.join(" · ")}`) : "";
}

export function stepRailLoopHeaderLine(
  step: WorkflowRunStoreSnapshot["steps"][number],
  item: Extract<StepRailChildRenderItem, { kind: "loop" }>,
) {
  const branch = item.isLast ? "└" : "├";
  const range = stepRailLoopRange(item.rows);
  return stepRailTextLine(`  ${branch}─ LOOP ${range} · ${stepRailLoopBadge(step)}`);
}

export function stepRailLoopRuleLine(item: Extract<StepRailChildRenderItem, { kind: "loop" }>, edge: "top" | "bottom") {
  const trunk = item.isLast ? " " : "│";
  if (edge === "top") {
    const prefix = `  ${trunk} ┌`;
    return stepRailTextLine(`${prefix}${"─".repeat(Math.max(0, STEP_RAIL_CONTENT_WIDTH - prefix.length))}`);
  }
  const first = item.rows[0]?.indexLabel ?? "";
  const last = item.rows.at(-1)?.indexLabel ?? "";
  return stepRailTextLine(`  ${trunk} └─ ${last} returns to ${first}`);
}

export function StepRailLoopBlock(props: {
  item: Extract<StepRailChildRenderItem, { kind: "loop" }>;
  parentStep: WorkflowRunStoreSnapshot["steps"][number];
  selectedStepId?: string;
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  onSelectStep(stepId: string): void;
}) {
  const trunk = () => props.item.isLast ? " " : "│";
  const iterationLine = () => stepRailLoopIterationLine(props.snapshot, props.parentStep, props.item.rows, trunk());
  return (
    <box flexDirection="column" width={STEP_RAIL_CONTENT_WIDTH}>
      <text fg={THEME.info} height={1} truncate={true} width={STEP_RAIL_CONTENT_WIDTH}>
        {stepRailLoopHeaderLine(props.parentStep, props.item)}
      </text>
      <Show when={iterationLine()}>
        {(line) => <text fg={THEME.muted} height={1} truncate={true} width={STEP_RAIL_CONTENT_WIDTH}>{line()}</text>}
      </Show>
      <text fg={THEME.accent} height={1} truncate={true} width={STEP_RAIL_CONTENT_WIDTH}>
        {stepRailLoopRuleLine(props.item, "top")}
      </text>
      <For each={props.item.rows}>
        {(child) => {
          const childSelected = () => props.selectedStepId === child.id;
          return (
            <box
              backgroundColor={childSelected() ? THEME.selected : undefined}
              flexDirection="row"
              height={1}
              width={STEP_RAIL_CONTENT_WIDTH}
              onMouseUp={(event) => {
                event.stopPropagation();
                props.onSelectStep(child.id);
              }}
            >
              <text fg={childSelected() ? THEME.accent : activityIndexColor(child.status)} height={1} truncate={true} width={STEP_RAIL_CONTENT_WIDTH}>
                {stepRailLine(
                  `  ${trunk()} │ ${childSelected() ? ">" : statusGlyph(child.status, props.spinnerFrame)} ${child.indexLabel} `,
                  child.label,
                )}
              </text>
            </box>
          );
        }}
      </For>
      <text fg={THEME.accent} height={1} truncate={true} width={STEP_RAIL_CONTENT_WIDTH}>
        {stepRailLoopRuleLine(props.item, "bottom")}
      </text>
    </box>
  );
}

export function StepRail(props: {
  collapsedStepIds?: ReadonlySet<string>;
  selectedStepId?: string;
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  onToggleCollapsed?(stepId: string): void;
  onSelectStep(stepId: string): void;
}) {
  const [localCollapsedStepIds, setLocalCollapsedStepIds] = createSignal<ReadonlySet<string>>(new Set());
  let lastClick: { at: number; stepId: string } | undefined;
  const collapsedStepIds = () => props.collapsedStepIds ?? localCollapsedStepIds();
  const isCollapsed = (stepId: string) => collapsedStepIds().has(stepId);
  const toggleCollapsed = (stepId: string) => {
    if (props.onToggleCollapsed) {
      props.onToggleCollapsed(stepId);
      return;
    }
    setLocalCollapsedStepIds((previous) => {
      const next = new Set(previous);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };
  const handleStepMouseUp = (
    stepId: string,
    hasChildren: boolean,
    event: TuiMouseEvent,
  ) => {
    event.preventDefault();
    const now = Date.now();
    if (hasChildren && lastClick?.stepId === stepId && now - lastClick.at <= 450) {
      toggleCollapsed(stepId);
      lastClick = undefined;
      return;
    }
    lastClick = { at: now, stepId };
    props.onSelectStep(stepId);
  };
  return (
    <box
      backgroundColor={THEME.background}
      border={["right"]}
      borderColor={THEME.border}
      flexDirection="column"
      flexShrink={0}
      paddingRight={1}
      width={STEP_RAIL_WIDTH}
    >
      <text fg={THEME.muted}>Workflow</text>
      <scrollbox flexGrow={1} minHeight={0} stickyScroll={false}>
        <For each={props.snapshot.steps}>
          {(step) => {
            const selected = () => props.selectedStepId === step.id;
            const childSteps = () => nestedStepRows(props.snapshot, step);
            const childItems = () => stepRailChildItems(childSteps());
            const hasChildren = () => childSteps().length > 0;
            const treeGlyph = () => hasChildren() ? isCollapsed(step.id) ? "▸" : "▾" : " ";
            const emphasized = () => selected() || step.status === "running" || step.status === "waiting";
            const lead = () => stepSpins(step.status) ? spinnerGlyph(props.spinnerFrame) : selected() ? ">" : " ";
            const prefix = () => hasChildren()
              ? `${lead()} ${treeGlyph()} ${formatStepIndex(step)} `
              : `${lead()} ${formatStepIndex(step)} `;
            return (
              <box
                backgroundColor={emphasized() ? THEME.selected : undefined}
                flexDirection="column"
                onMouseUp={(event) => handleStepMouseUp(step.id, hasChildren(), event)}
                width={STEP_RAIL_CONTENT_WIDTH}
              >
                <text fg={boundaryStepColor(step) ?? (selected() ? THEME.accent : stepStatusColor(step.status))} height={1} truncate={true} width={STEP_RAIL_CONTENT_WIDTH}>
                  {stepRailLine(prefix(), workflowStepDisplayLabel(step))}
                </text>
                <text fg={THEME.muted} height={1} truncate={true} width={STEP_RAIL_CONTENT_WIDTH}>
                  {stepRailStatusLine(step)}
                </text>
                <Show when={!isCollapsed(step.id)}>
                  <For each={childItems()}>
                    {(item) => {
                      if (item.kind === "loop") {
                        return (
                          <StepRailLoopBlock
                            item={item}
                            parentStep={step}
                            selectedStepId={props.selectedStepId}
                            snapshot={props.snapshot}
                            spinnerFrame={props.spinnerFrame}
                            onSelectStep={props.onSelectStep}
                          />
                        );
                      }
                      const child = item.child;
                      const childSelected = () => props.selectedStepId === child.id;
                      return (
                        <box
                          backgroundColor={childSelected() ? THEME.selected : undefined}
                          flexDirection="row"
                          height={1}
                          width={STEP_RAIL_CONTENT_WIDTH}
                          onMouseUp={(event) => {
                            event.stopPropagation();
                            props.onSelectStep(child.id);
                          }}
                        >
                          <text fg={childSelected() ? THEME.accent : activityIndexColor(child.status)} height={1} truncate={true} width={STEP_RAIL_CONTENT_WIDTH}>
                            {stepRailLine(
                              `  ${item.isLast ? "└" : "├"}${
                                childSelected() ? ">" : statusGlyph(child.status, props.spinnerFrame)
                              } ${child.indexLabel} `,
                              child.label,
                            )}
                          </text>
                        </box>
                      );
                    }}
                  </For>
                </Show>
              </box>
            );
          }}
        </For>
      </scrollbox>
    </box>
  );
}
