/** @jsxImportSource @opentui/solid */
import { type WorkflowAppRunSnapshot } from "../workflow-app.js";
import { clampNumber, PaletteLine } from "./command-palette.js";
import { PromptFileViewerScrollbar } from "./dialogs-popups.js";
import { clampIndex } from "./routing-keyboard.js";
import { truncate } from "./string-format.js";
import { THEME } from "./style.js";
import { type WorkflowSessionListDialogState } from "./types.js";
import { type MouseEvent as TuiMouseEvent } from "@opentui/core";
import { For, Show } from "solid-js";

export function WorkflowSessionListDialog(props: {
  currentRunId?: string;
  selectedWorkflowTitle: string;
  state: WorkflowSessionListDialogState;
  terminalHeight: number;
  terminalWidth: number;
  onScroll(direction: "down" | "left" | "right" | "up"): void;
}) {
  const width = () => Math.max(64, Math.min(112, props.terminalWidth - 8));
  const height = () => workflowSessionListDialogHeight(props.state, props.terminalHeight);
  const left = () => Math.max(2, Math.floor((props.terminalWidth - width()) / 2));
  const top = () => Math.max(2, Math.floor((props.terminalHeight - height()) / 2));
  const rows = () => filteredWorkflowSessionRuns(props.state.runs, props.state.query);
  const visibleCount = () => Math.max(1, height() - 8);
  const selectedIndex = () => clampIndex(props.state.selectedIndex, rows().length);
  const maxScrollOffset = () => Math.max(0, rows().length - visibleCount());
  const visibleStart = () => clampNumber(props.state.scrollOffset, 0, maxScrollOffset());
  const visibleEnd = () => Math.min(rows().length, visibleStart() + visibleCount());
  const visibleRows = () => rows().slice(visibleStart(), visibleStart() + visibleCount());
  const idWidth = () => Math.max(16, Math.min(28, Math.floor(width() * 0.22)));
  const statusWidth = () => 11;
  const timeWidth = () => 18;
  const scrollable = () => rows().length > visibleCount();
  const handleMouseScroll = (event: TuiMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.scroll?.direction) props.onScroll(event.scroll.direction);
  };
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
      onMouseScroll={handleMouseScroll}
    >
      <box flexDirection="row" height={1}>
        <text fg={THEME.text} flexGrow={1} height={1} truncate={true}>
          Sessions · {props.selectedWorkflowTitle}
        </text>
        <text fg={THEME.muted} height={1} truncate={true}>
          {scrollable() ? "wheel/↑↓ scroll · enter open · esc" : "enter open · esc"}
        </text>
      </box>
      <text fg={THEME.muted} height={1} truncate={true}>
        {props.state.query.trim() ? `Filter  ${props.state.query}` : "Filter"}
      </text>
      <Show when={props.state.error}>
        {(error) => <text fg={THEME.warning} height={1} truncate={true}>stored runs unavailable · {error()}</text>}
      </Show>
      <Show when={!props.state.error}>
        <box height={1} />
      </Show>
      <box border={["bottom"]} borderColor={THEME.border} flexDirection="row" height={2} paddingTop={1}>
        <text fg={THEME.muted} height={1} width={idWidth()} truncate={true}>RUN</text>
        <text fg={THEME.muted} height={1} width={statusWidth()} truncate={true}>STATUS</text>
        <text fg={THEME.muted} flexGrow={1} height={1} truncate={true}>INPUT</text>
        <text fg={THEME.muted} height={1} width={timeWidth()} truncate={true}>UPDATED</text>
      </box>
      <Show
        when={!props.state.loading}
        fallback={<PaletteLine fg={THEME.muted} text="Loading sessions..." />}
      >
        <Show when={rows().length > 0} fallback={<PaletteLine fg={THEME.muted} text="No previous sessions for this workflow" />}>
          <box flexDirection="row" flexGrow={1} minHeight={0} overflow="hidden">
            <box flexDirection="column" flexGrow={1} minWidth={0}>
              <For each={visibleRows()}>
                {(run, index) => (
                  <WorkflowSessionListRow
                    current={props.currentRunId === run.runId}
                    idWidth={idWidth()}
                    run={run}
                    selected={visibleStart() + index() === selectedIndex()}
                    statusWidth={statusWidth()}
                    timeWidth={timeWidth()}
                  />
                )}
              </For>
            </box>
            <Show when={scrollable()}>
              <PromptFileViewerScrollbar
                offset={visibleStart()}
                totalRows={rows().length}
                visibleRows={visibleCount()}
              />
            </Show>
          </box>
        </Show>
      </Show>
      <Show when={rows().length > 0}>
        <text fg={THEME.muted} height={1} truncate={true}>
          {scrollable()
            ? `${visibleStart() + 1}-${visibleEnd()} of ${rows().length} · pageup/pagedown home/end`
            : `${rows().length} session${rows().length === 1 ? "" : "s"}`}
        </text>
      </Show>
    </box>
  );
}

export function WorkflowSessionListRow(props: {
  current: boolean;
  idWidth: number;
  run: WorkflowAppRunSnapshot;
  selected: boolean;
  statusWidth: number;
  timeWidth: number;
}) {
  return (
    <box
      backgroundColor={props.selected ? THEME.selected : undefined}
      flexDirection="row"
      height={1}
    >
      <text fg={props.selected ? THEME.warning : THEME.text} height={1} truncate={true} width={2}>
        {props.selected ? "› " : "  "}
      </text>
      <text fg={props.current ? THEME.accent : THEME.text} height={1} truncate={true} width={props.idWidth}>
        {shortRunId(props.run.runId)}
      </text>
      <text fg={sessionStatusColor(props.run.status)} height={1} truncate={true} width={props.statusWidth}>
        {props.current ? "current" : props.run.status}
      </text>
      <text fg={THEME.text} flexGrow={1} height={1} truncate={true}>
        {workflowSessionInputPreview(props.run)}
      </text>
      <text fg={THEME.muted} height={1} truncate={true} width={props.timeWidth}>
        {workflowSessionUpdatedLabel(props.run)}
      </text>
    </box>
  );
}

export function filteredWorkflowSessionRuns(runs: WorkflowAppRunSnapshot[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return runs;
  return runs.filter((run) =>
    run.runId.toLowerCase().includes(normalized) ||
    run.status.toLowerCase().includes(normalized) ||
    workflowSessionInputPreview(run).toLowerCase().includes(normalized)
  );
}

export function normalizeWorkflowSessionListPosition(
  state: WorkflowSessionListDialogState,
  visibleCount: number,
): Pick<WorkflowSessionListDialogState, "scrollOffset" | "selectedIndex"> {
  const rows = filteredWorkflowSessionRuns(state.runs, state.query);
  const selectedIndex = clampNumber(state.selectedIndex, 0, Math.max(0, rows.length - 1));
  let scrollOffset = clampNumber(state.scrollOffset, 0, Math.max(0, rows.length - visibleCount));
  if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
  if (selectedIndex >= scrollOffset + visibleCount) scrollOffset = selectedIndex - visibleCount + 1;
  return {
    scrollOffset: clampNumber(scrollOffset, 0, Math.max(0, rows.length - visibleCount)),
    selectedIndex,
  };
}

export function workflowSessionListVisibleCount(state: WorkflowSessionListDialogState, terminalHeight: number) {
  return Math.max(1, workflowSessionListDialogHeight(state, terminalHeight) - 8);
}

export function workflowSessionListDialogHeight(state: WorkflowSessionListDialogState, terminalHeight: number) {
  return clampNumber(
    Math.min(Math.max(12, state.runs.length + 8), terminalHeight - 8),
    12,
    28,
  );
}

export function workflowSessionInputPreview(run: WorkflowAppRunSnapshot) {
  const input = typeof run.input === "string" ? run.input : JSON.stringify(run.input);
  const trimmed = input.replace(/\s+/g, " ").trim();
  if (!trimmed) return "no input";
  return trimmed.length > 96 ? `${trimmed.slice(0, 93)}...` : trimmed;
}

export function workflowSessionUpdatedLabel(run: WorkflowAppRunSnapshot) {
  const timestamp = workflowSessionUpdatedAt(run);
  if (!timestamp) return "no activity";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

export function workflowSessionUpdatedAt(run: WorkflowAppRunSnapshot) {
  for (const event of [...run.events].reverse()) {
    if (event.timestamp) return event.timestamp;
  }
  return undefined;
}

export function shortRunId(runId: string) {
  if (runId.length <= 28) return runId;
  return `${runId.slice(0, 10)}...${runId.slice(-12)}`;
}

export function sessionStatusColor(status: string) {
  if (status === "completed") return THEME.success;
  if (status === "failed" || status === "cancelled") return THEME.error;
  if (status === "waiting") return THEME.warning;
  if (status === "running") return THEME.info;
  return THEME.muted;
}
