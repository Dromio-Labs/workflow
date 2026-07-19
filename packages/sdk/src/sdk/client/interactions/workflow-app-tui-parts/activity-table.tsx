/** @jsxImportSource @opentui/solid */
import { type WorkflowRunConversationSection, type WorkflowRunConversationView, type WorkflowRunSemanticRow, type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { type WorkflowStepPromptDetailRow, type WorkflowStepRelatedFileRow } from "./artifact-step-pages.js";
import { artifactDisplayPath } from "./dialogs-popups.js";
import { statusColor, statusGlyph } from "./routing-keyboard.js";
import { compactJsonString } from "./step-detail-view.js";
import { truncate } from "./string-format.js";
import { ACTIVITY_COLUMNS, THEME } from "./style.js";
import { type ShellStatus } from "./types.js";
import { type WorkflowDesignNode } from "./workflow-design.js";
import { formatModelRef, formatStepPromptDirectory, formatStepPromptRole, listStepRelatedFiles, resolveSourcePath, stepCatalogDirectory, type StepPromptView, stepRelatedFileRole } from "./workflow-file-helpers.js";
import { type MouseEvent as TuiMouseEvent } from "@opentui/core";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { createSignal, For, type JSX, Show } from "solid-js";

export function ActivityTable(props: {
  conversations?: WorkflowRunConversationView[];
  emptyText: string;
  onOpenRowContent?(title: string, content: string): void;
  rows: WorkflowRunSemanticRow[];
  spinnerFrame: number;
}) {
  const [selectedRowId, setSelectedRowId] = createSignal<string | undefined>();
  let lastClick: { at: number; rowId: string } | undefined;
  const conversationForRow = (row: WorkflowRunSemanticRow) =>
    props.conversations?.find((conversation) =>
      conversation.id === row.conversationId ||
      conversation.activityRowId === row.id ||
      conversation.eventIndexes.includes(row.eventIndex ?? -1)
    );
  const handleRowMouseUp = (rowId: string, event: TuiMouseEvent) => {
    event.preventDefault();
    setSelectedRowId(rowId);
    const now = Date.now();
    if (lastClick?.rowId === rowId && now - lastClick.at <= 450) {
      const row = props.rows.find((candidate) => candidate.id === rowId);
      if (row) {
        const conversation = conversationForRow(row);
        props.onOpenRowContent?.(
          activityRowContentTitle(row, conversation),
          activityRowContent(row, conversation),
        );
      }
      lastClick = undefined;
      return;
    }
    lastClick = { at: now, rowId };
  };
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <box
        border={["top", "bottom"]}
        borderColor={THEME.border}
        flexDirection="row"
        paddingBottom={1}
        paddingTop={1}
      >
        <ActivityHeaderCell width={ACTIVITY_COLUMNS.status} text="" />
        <ActivityHeaderCell width={ACTIVITY_COLUMNS.index} text="STEP" />
        <ActivityHeaderCell width={ACTIVITY_COLUMNS.type} text="TYPE" />
        <text fg={THEME.muted} flexGrow={1} height={1} truncate={true}>DETAILS</text>
        <ActivityHeaderCell width={ACTIVITY_COLUMNS.duration} text="DURATION" />
        <ActivityHeaderCell width={ACTIVITY_COLUMNS.time} text="TIME" />
      </box>
      <Show when={props.rows.length > 0} fallback={<text fg={THEME.muted}>{props.emptyText}</text>}>
	        <For each={props.rows}>
	          {(row, index) => (
	            <ActivityTableRow
	              index={index() + 1}
	              row={row}
	              selected={selectedRowId() === row.id}
	              spinnerFrame={props.spinnerFrame}
	              onMouseUp={handleRowMouseUp}
	            />
	          )}
	        </For>
      </Show>
    </box>
  );
}

export function ActivityHeaderCell(props: {
  text: string;
  width: number;
}) {
  return (
    <text fg={THEME.muted} height={1} truncate={true} width={props.width}>
      {props.text}
    </text>
  );
}

export function ActivityTableRow(props: {
  index: number;
  onMouseUp(rowId: string, event: TuiMouseEvent): void;
  row: WorkflowRunSemanticRow;
  selected: boolean;
  spinnerFrame: number;
}) {
  const children = () => {
    const allChildren = flattenActivityChildren(props.row.children ?? []);
    return allChildren.slice(0, 4);
  };
  return (
    <box flexDirection="column" onMouseUp={(event) => props.onMouseUp(props.row.id, event)}>
      <box backgroundColor={props.selected ? THEME.selected : undefined} flexDirection="row" paddingTop={1}>
        <text fg={statusColor(props.row.status)} height={1} truncate={true} width={ACTIVITY_COLUMNS.status}>
          {statusGlyph(props.row.status, props.spinnerFrame)}
        </text>
        <text fg={activityIndexColor(props.row.status)} height={1} truncate={true} width={ACTIVITY_COLUMNS.index}>
          {props.index}
        </text>
        <text fg={THEME.text} height={1} truncate={true} width={ACTIVITY_COLUMNS.type}>
          {activityTypeText(props.row)}
        </text>
        <text fg={THEME.text} flexGrow={1} height={1} truncate={true}>
          {activityDetails(props.row)}
        </text>
        <text fg={props.row.durationLabel ? THEME.info : THEME.muted} height={1} truncate={true} width={ACTIVITY_COLUMNS.duration}>
          {props.row.durationLabel ?? ""}
        </text>
        <text fg={THEME.muted} height={1} truncate={true} width={ACTIVITY_COLUMNS.time}>
          {activityTime(props.row)}
        </text>
      </box>
      <For each={children()}>
        {(child) => (
          <box flexDirection="row" overflow="hidden">
            <text fg={THEME.muted} height={1} width={ACTIVITY_COLUMNS.status + ACTIVITY_COLUMNS.index + ACTIVITY_COLUMNS.type}> </text>
            <ActivityDetailCell fg={THEME.muted}>{child}</ActivityDetailCell>
            <text fg={THEME.muted} height={1} width={ACTIVITY_COLUMNS.duration + ACTIVITY_COLUMNS.time}> </text>
          </box>
        )}
      </For>
    </box>
  );
}

export function ActivityDetailCell(props: {
  children: JSX.Element;
  fg: string;
}) {
  return (
    <box flexGrow={1} minWidth={0} overflow="hidden">
      <text fg={props.fg} height={1} truncate={true}>
        {props.children}
      </text>
    </box>
  );
}

export function activityRowContentTitle(
  row: WorkflowRunSemanticRow,
  conversation: WorkflowRunConversationView | undefined,
) {
  return conversation?.title ?? activityDetails(row);
}

export function activityRowContent(
  row: WorkflowRunSemanticRow,
  conversation: WorkflowRunConversationView | undefined,
) {
  if (conversation) {
    return modelConversationLines(conversation).map((line) => line.text).join("\n");
  }
  const detailLines = flattenActivityChildren(row.children ?? []);
  return [
    activityDetails(row),
    "",
    `type: ${activityTypeLabel(row)}`,
    row.eventType ? `event: ${row.eventType}` : undefined,
    row.provider ? `provider: ${row.provider}` : undefined,
    row.stepId ? `step: ${row.stepId}` : undefined,
    row.durationLabel ? `duration: ${row.durationLabel}` : undefined,
    activityTime(row) ? `time: ${activityTime(row)}` : undefined,
    row.trace?.traceId ? `traceId: ${row.trace.traceId}` : undefined,
    row.trace?.spanId ? `spanId: ${row.trace.spanId}` : undefined,
    row.trace?.parentSpanId ? `parentSpanId: ${row.trace.parentSpanId}` : undefined,
    ...providerRefContentLines(row.providerRefs),
    ...(detailLines.length > 0 ? ["", "DETAILS", ...detailLines] : []),
  ].filter((line): line is string => typeof line === "string").join("\n");
}

export function providerRefContentLines(refs: Record<string, string | undefined> | undefined) {
  if (!refs) return [];
  return Object.entries(refs)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .map(([key, value]) => `${key}: ${value}`);
}

export function modelConversationLines(conversation: WorkflowRunConversationView) {
  const refs = conversation.providerRefs ?? {};
  const meta = [
    conversation.provider ? `provider ${conversation.provider}` : undefined,
    conversation.model ? `model ${conversation.model}` : undefined,
    conversation.stepId ? `step ${conversation.stepId}` : undefined,
    `${conversation.eventsCount} events`,
  ].filter((item): item is string => Boolean(item));
  const lines: Array<{ fg: string; text: string }> = [
    { fg: THEME.accent, text: `Model conversation · ${conversation.provider ?? "provider"}` },
    { fg: THEME.muted, text: meta.join(" · ") },
    ...providerRefLines(refs),
    ...traceMetadataLines(conversation.trace),
  ];
  for (const section of conversation.sections) {
    lines.push(...modelConversationSectionLines(section));
  }
  if (conversation.sections.length === 0) {
    lines.push({
      fg: THEME.muted,
      text: "No conversation payload for this activity. Raw event data may still be available in the run stream.",
    });
  }
  return lines;
}

export function providerRefLines(refs: Record<string, string | undefined>) {
  return Object.entries(refs)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .slice(0, 4)
    .map(([key, value]) => ({ fg: THEME.info, text: `${key}: ${value}` }));
}

export function traceMetadataLines(trace: WorkflowRunConversationView["trace"]) {
  if (!trace) return [];
  return [
    trace.traceId ? { fg: THEME.muted, text: `traceId: ${trace.traceId}` } : undefined,
    trace.spanId ? { fg: THEME.muted, text: `spanId: ${trace.spanId}` } : undefined,
    trace.parentSpanId ? { fg: THEME.muted, text: `parentSpanId: ${trace.parentSpanId}` } : undefined,
  ].filter((line): line is { fg: string; text: string } => Boolean(line));
}

export function modelConversationSectionLines(section: WorkflowRunConversationSection) {
  const titleFg = section.kind === "raw" ? THEME.warning : section.kind === "error" ? THEME.error : THEME.muted;
  const lines: Array<{ fg: string; text: string }> = [{ fg: titleFg, text: sectionTitleText(section) }];
  if (section.kind === "prompt" || section.kind === "assistant" || section.kind === "final") {
    lines.push(...conversationTextLines(section.text, section.kind === "final" ? THEME.success : THEME.text));
  } else if (section.kind === "toolCall") {
    if (section.input !== undefined) lines.push({ fg: THEME.muted, text: `input: ${compactJsonString(section.input)}` });
    if (section.output !== undefined) lines.push({ fg: THEME.success, text: `output: ${compactJsonString(section.output)}` });
    lines.push({ fg: section.status === "failed" ? THEME.error : THEME.info, text: `status: ${section.status}` });
  } else if (section.kind === "error") {
    lines.push({ fg: THEME.error, text: section.error });
  } else if (section.kind === "raw") {
    lines.push({ fg: THEME.warning, text: `${section.eventType}: ${compactJsonString(section.preview)}` });
  }
  return lines;
}

export function sectionTitleText(section: WorkflowRunConversationSection) {
  if (section.kind === "assistant" || section.kind === "final") return `${section.title} · ${section.chars} chars`;
  return section.title;
}

export function conversationTextLines(value: string, fg: string) {
  const normalized = value.replace(/\r/g, "").split("\n").flatMap((line) => wrapConversationLine(line));
  const visible = normalized.filter((line) => line.trim().length > 0).slice(0, 80);
  return visible.map((line) => ({ fg, text: `  ${line}` }));
}

export function wrapConversationLine(value: string) {
  const text = value.trim();
  if (text.length <= 120) return [text];
  const lines: string[] = [];
  for (let index = 0; index < text.length && lines.length < 80; index += 120) {
    lines.push(text.slice(index, index + 120));
  }
  return lines;
}

export function activityIndexColor(status: string) {
  if (status === "ok") return THEME.success;
  if (status === "running") return THEME.info;
  if (status === "error") return THEME.error;
  if (status === "warning") return THEME.warning;
  return THEME.muted;
}

export function activityTypeLabel(row: WorkflowRunSemanticRow) {
  return row.phaseTitle || row.phaseId;
}

export function activityTypeText(row: WorkflowRunSemanticRow) {
  return `${activityTypeIcon(row)} ${activityTypeLabel(row)}`;
}

export function activityTypeIcon(row: WorkflowRunSemanticRow) {
  const key = `${row.phaseId} ${row.phaseTitle}`.toLowerCase();
  if (key.includes("image")) return "▧";
  if (key.includes("item")) return "◍";
  if (key.includes("model")) return "◇";
  if (key.includes("question")) return "?";
  if (key.includes("command")) return "$";
  if (key.includes("evaluation") || key.includes("score")) return "%";
  if (key.includes("run")) return "◎";
  return "⚙";
}

export function activityDetails(row: WorkflowRunSemanticRow) {
  return row.text.replace(/\s+\[[^[\]]+\]$/, "");
}

export function activityTime(row: WorkflowRunSemanticRow) {
  return [row.clockLabel, row.elapsedLabel].filter(Boolean).join(" ");
}

export function runDurationText(snapshot: WorkflowRunStoreSnapshot, status: ShellStatus | WorkflowRunStoreSnapshot["status"]) {
  if (!snapshot.runDurationLabel) return "";
  return `${status === "running" || status === "waiting" ? "elapsed" : "duration"}: ${snapshot.runDurationLabel}`;
}

export function flattenActivityChildren(
  children: NonNullable<WorkflowRunSemanticRow["children"]>,
  depth = 0,
): string[] {
  return children.flatMap((child) => {
    if (typeof child === "string") return [`${"  ".repeat(depth)}${child}`];
    return [
      `${"  ".repeat(depth)}${child.text}`,
      ...flattenActivityChildren(child.children ?? [], depth + 1),
    ];
  });
}

export function formatStepModel(model: {
  requested?: { id: string; label?: string; model?: string; worker?: string };
  selected?: { id: string; label?: string; model?: string; worker?: string };
}) {
  const selected = model.selected ?? model.requested;
  if (!selected) return "unconfigured";
  const selectedLabel = formatModelRef(selected);
  if (!model.requested || model.requested.id === selected.id) return selectedLabel;
  return `${formatModelRef(model.requested)} -> ${selectedLabel}`;
}

export function stepPromptModels(step: {
  models?: Array<{
    label?: string;
    operation: string;
    prompt?: StepPromptView;
  }>;
}) {
  return (step.models ?? []).filter((model): model is {
    label?: string;
    operation: string;
    prompt: StepPromptView;
  } => Boolean(model.prompt));
}

export function stepPromptDetailRows(step: {
  models?: Array<{
    label?: string;
    operation: string;
    prompt?: StepPromptView;
  }>;
}): WorkflowStepPromptDetailRow[] {
  return stepPromptModels(step)
    .flatMap((model) => {
      if (model.prompt.kind !== "file") return [];
      return [{
        directory: formatStepPromptDirectory(model.prompt),
        file: path.basename(model.prompt.path),
        path: model.prompt.path,
        role: formatStepPromptRole(model),
      }];
    });
}

export function stepRelatedFileRows(step: WorkflowDesignNode | undefined): WorkflowStepRelatedFileRow[] {
  if (!step || step.boundary) return [];
  const directory = stepCatalogDirectory(step);
  if (!directory || !existsSync(directory)) return [];
  const files = listStepRelatedFiles(directory);
  const implementationSource = step.catalog?.implementation?.source;
  const implementationPath = implementationSource ? resolveSourcePath(implementationSource) : path.join(directory, "step.ts");
  return files.map((filePath) => ({
    directory: artifactDisplayPath(path.dirname(filePath)),
    file: path.basename(filePath),
    path: filePath,
    role: stepRelatedFileRole(filePath, implementationPath),
  }));
}
