/** @jsxImportSource @opentui/solid */
import { stepPromptDetailRows } from "./activity-table.js";
import { displayText, type WorkflowOverviewRow, type WorkflowStepPromptDetailRow, type WorkflowStepRelatedFileRow } from "./artifact-step-pages.js";
import { workflowConfigSourceColor } from "./config-utils.js";
import { truncate } from "./string-format.js";
import { THEME, WORKFLOW_DETAIL_EXPANDED_LINES } from "./style.js";
import { type WorkflowDesignNode, workflowDesignNodeIndexLabel } from "./workflow-design.js";
import { promptRoleColor, stepFileRoleColor } from "./workflow-file-helpers.js";
import { type MouseEvent as TuiMouseEvent } from "@opentui/core";
import * as path from "node:path";
import { createSignal, For, type JSX, Show } from "solid-js";

export function StepPromptFilesSection(props: {
  onOpenPromptFile(filePath: string): void;
  onSelectRow?(index: number): void;
  selectedRowIndex?: number;
  selectionOffset?: number;
  step?: WorkflowDesignNode;
}) {
  const [expanded, setExpanded] = createSignal(false);
  let lastExpandClickAt = 0;
  let lastFileClick: { at: number; path: string } | undefined;
  const promptRows = () => stepPromptDetailRows(props.step ?? {});
  const needsExpansion = () => promptRows().length > WORKFLOW_DETAIL_EXPANDED_LINES;
  const visibleLines = () => {
    const rows = promptRows();
    return expanded() ? rows : rows.slice(0, WORKFLOW_DETAIL_EXPANDED_LINES);
  };
  const handleExpandMouseUp = (event: TuiMouseEvent) => {
    event.preventDefault();
    const now = Date.now();
    if (now - lastExpandClickAt <= 450) {
      setExpanded((value) => !value);
      lastExpandClickAt = 0;
      return;
    }
    lastExpandClickAt = now;
  };
  const handlePromptFileMouseUp = (row: WorkflowStepPromptDetailRow, index: number, event: TuiMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onSelectRow?.((props.selectionOffset ?? 0) + index);
    if (!row.path) return;
    const now = Date.now();
    if (lastFileClick?.path === row.path && now - lastFileClick.at <= 450) {
      props.onOpenPromptFile(row.path);
      lastFileClick = undefined;
      return;
    }
    lastFileClick = { at: now, path: row.path };
  };
  return (
    <Show when={promptRows().length > 0}>
      <MetadataSection
        rowCount={visibleLines().length + 2 + (needsExpansion() ? 1 : 0)}
        title="STEP PROMPT FILES"
      >
          <box flexDirection="column">
            <text fg={THEME.text} height={1} truncate={true}>
            {props.step ? `${workflowDesignNodeIndexLabel(props.step)} ${displayText(props.step.label)}` : "Selected step"}
          </text>
          <box flexDirection="row" height={1}>
            <text fg={THEME.muted} height={1} truncate={true} width={12}>
              ROLE
            </text>
            <text fg={THEME.muted} height={1} truncate={true} width={18}>
              FILE
            </text>
            <text fg={THEME.muted} flexGrow={1} height={1} truncate={true}>
              PATH
            </text>
          </box>
          <For each={visibleLines()}>
            {(row, index) => {
              const rowIndex = () => (props.selectionOffset ?? 0) + index();
              const selected = () => Boolean(props.onSelectRow) && props.selectedRowIndex === rowIndex();
              return (
              <box
                backgroundColor={selected() ? THEME.selected : undefined}
                flexDirection="row"
                height={1}
                onMouseUp={(event) => handlePromptFileMouseUp(row, index(), event)}
              >
                <text fg={selected() ? THEME.accent : promptRoleColor(row.role)} height={1} truncate={true} width={12}>
                  {row.role}
                </text>
                <text fg={selected() ? THEME.text : THEME.muted} height={1} truncate={true} width={18}>
                  {row.file}
                </text>
                <text fg={THEME.info} flexGrow={1} height={1} truncate={true}>
                  {row.directory}
                </text>
              </box>
              );
            }}
          </For>
          <Show when={needsExpansion()}>
            <text fg={THEME.muted} height={1} onMouseUp={handleExpandMouseUp} truncate={true}>
              {expanded() ? "..." : "double-click expand"}
            </text>
          </Show>
        </box>
      </MetadataSection>
    </Show>
  );
}

export function WorkflowOverviewSection(props: {
  rows: WorkflowOverviewRow[];
  selectedRowIndex?: number;
  onSelectRow?(index: number): void;
}) {
  return (
    <Show when={props.rows.length > 0}>
      <MetadataSection rowCount={props.rows.length} title="WORKFLOW">
        <For each={props.rows}>
          {(row, index) => (
            <MetadataRow
              fg={row.fg}
              label={row.label}
              selected={props.selectedRowIndex === index()}
              value={row.value}
              onSelect={() => props.onSelectRow?.(index())}
            />
          )}
        </For>
      </MetadataSection>
    </Show>
  );
}

export function StepFilesSection(props: {
  rows: WorkflowStepRelatedFileRow[];
  selectedRowIndex?: number;
  selectionOffset: number;
  title: string;
  onOpenFile(filePath: string): void;
  onSelectRow?(index: number): void;
}) {
  let lastFileClick: { at: number; path: string } | undefined;
  const handleFileMouseUp = (row: WorkflowStepRelatedFileRow, index: number, event: TuiMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onSelectRow?.(props.selectionOffset + index);
    const now = Date.now();
    if (lastFileClick?.path === row.path && now - lastFileClick.at <= 450) {
      props.onOpenFile(row.path);
      lastFileClick = undefined;
      return;
    }
    lastFileClick = { at: now, path: row.path };
  };
  return (
    <Show when={props.rows.length > 0}>
      <MetadataSection
        rowCount={props.rows.length + 1}
        title={props.title}
        separated={true}
      >
        <box flexDirection="column">
          <box flexDirection="row" height={1}>
            <text fg={THEME.muted} height={1} truncate={true} width={12}>
              ROLE
            </text>
            <text fg={THEME.muted} height={1} truncate={true} width={20}>
              FILE
            </text>
            <text fg={THEME.muted} flexGrow={1} height={1} truncate={true}>
              PATH
            </text>
          </box>
          <For each={props.rows}>
            {(row, index) => {
              const rowIndex = () => props.selectionOffset + index();
              const selected = () => props.selectedRowIndex === rowIndex();
              return (
                <box
                  backgroundColor={selected() ? THEME.selected : undefined}
                  flexDirection="row"
                  height={1}
                  onMouseUp={(event) => handleFileMouseUp(row, index(), event)}
                >
                  <text fg={selected() ? THEME.accent : stepFileRoleColor(row.role)} height={1} truncate={true} width={12}>
                    {row.role}
                  </text>
                  <text fg={selected() ? THEME.text : THEME.muted} height={1} truncate={true} width={20}>
                    {row.file}
                  </text>
                  <text fg={THEME.info} flexGrow={1} height={1} truncate={true}>
                    {row.directory}
                  </text>
                </box>
              );
            }}
          </For>
        </box>
      </MetadataSection>
    </Show>
  );
}

export function metadataLinesEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((line, index) => line === right[index]);
}

export function MetadataLinesSection(props: {
  lines: string[];
  selectedRowIndex?: number;
  selectionOffset?: number;
  title: string;
  onSelectRow?(index: number): void;
}) {
  const visibleLines = () => props.lines.length > 0 ? props.lines.slice(0, 9) : ["-"];
  return (
    <MetadataSection rowCount={visibleLines().length} title={props.title} separated={true}>
      <For each={visibleLines()}>
        {(line, index) => {
          const rowIndex = () => (props.selectionOffset ?? 0) + index();
          const selected = () => props.selectedRowIndex === rowIndex();
          return (
            <box
              backgroundColor={selected() ? THEME.selected : undefined}
              height={1}
              onMouseUp={() => props.onSelectRow?.(rowIndex())}
            >
              <text fg={selected() ? THEME.accent : schemaLineColor(line)} height={1} truncate={true}>
                {truncate(line, 96)}
              </text>
            </box>
          );
        }}
      </For>
    </MetadataSection>
  );
}

export function visibleMetadataLineCount(lines: string[]) {
  return (lines.length > 0 ? lines : ["-"]).slice(0, 9).length;
}

export function schemaLineColor(line: string) {
  if (line.startsWith("*")) return THEME.warning;
  if (line.startsWith("-") || line.startsWith(" ")) return THEME.info;
  return THEME.text;
}

export function MetadataSection(props: {
  children: JSX.Element;
  rowCount: number;
  separated?: boolean;
  title: string;
}) {
  return (
    <box
      flexDirection="column"
      height={props.rowCount + (props.separated ? 4 : 3)}
      paddingBottom={1}
      paddingTop={props.separated ? 1 : 0}
    >
      <text fg={THEME.muted} height={1} truncate={true}>
        {props.title}
      </text>
      <text fg={THEME.border} height={1} truncate={true}>
        {"─".repeat(96)}
      </text>
      {props.children}
    </box>
  );
}

export function MetadataRow(props: {
  fg?: string;
  hint?: string;
  label: string;
  onSelect?(): void;
  selected?: boolean;
  value: string;
}) {
  return (
    <box
      backgroundColor={props.selected ? THEME.selected : undefined}
      flexDirection="row"
      height={1}
      onMouseUp={() => props.onSelect?.()}
    >
      <text fg={props.selected ? THEME.accent : THEME.text} height={1} truncate={true} width={24}>
        {props.label}
      </text>
      <text
        fg={props.fg ?? THEME.info}
        flexGrow={props.hint ? 0 : 1}
        height={1}
        truncate={true}
        width={props.hint ? 34 : undefined}
      >
        {props.value}
      </text>
      <Show when={props.hint}>
        {(hint) => (
          <text fg={THEME.muted} flexGrow={1} height={1} truncate={true}>
            {hint()}
          </text>
        )}
      </Show>
    </box>
  );
}

export function ConfigMetadataHeader() {
  return (
    <box flexDirection="row" height={1}>
      <text fg={THEME.muted} height={1} truncate={true} width={24}>
        FIELD
      </text>
      <text fg={THEME.muted} height={1} truncate={true} width={34}>
        VALUE
      </text>
      <text fg={THEME.muted} height={1} truncate={true} width={12}>
        SOURCE
      </text>
      <text fg={THEME.muted} flexGrow={1} height={1} truncate={true}>
        ENV / INPUT
      </text>
    </box>
  );
}

export function ConfigMetadataRow(props: {
  fg?: string;
  label: string;
  onEdit(): void;
  onSelect?(): void;
  selected?: boolean;
  source: string;
  value: string;
  via: string;
}) {
  let lastValueClickAt = 0;
  const handleValueMouseUp = (event: TuiMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onSelect?.();
    const now = Date.now();
    if (now - lastValueClickAt <= 450) {
      props.onEdit();
      lastValueClickAt = 0;
      return;
    }
    lastValueClickAt = now;
  };
  return (
    <box backgroundColor={props.selected ? THEME.selected : undefined} flexDirection="row" height={1}>
      <text fg={props.selected ? THEME.accent : THEME.text} height={1} truncate={true} width={24}>
        {props.label}
      </text>
      <text
        fg={props.fg ?? THEME.info}
        height={1}
        onMouseUp={handleValueMouseUp}
        truncate={true}
        width={34}
      >
        {props.value}
      </text>
      <text fg={workflowConfigSourceColor(props.source)} height={1} truncate={true} width={12}>
        {props.source}
      </text>
      <text fg={THEME.muted} flexGrow={1} height={1} truncate={true}>
        {props.via}
      </text>
    </box>
  );
}
