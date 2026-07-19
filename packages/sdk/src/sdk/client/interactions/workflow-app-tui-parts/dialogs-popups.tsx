/** @jsxImportSource @opentui/solid */
import { type WorkflowApp } from "../workflow-app.js";
import { type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { paintDisplaySpaces } from "./artifact-step-pages.js";
import { clampNumber } from "./command-palette.js";
import { wrapLine, wrappedValueLines } from "./config-utils.js";
import { truncate } from "./string-format.js";
import { getWorkflowTuiSyntaxStyle, THEME } from "./style.js";
import { type ConfigValueEditor, type PromptFileViewer, type ResultArtifactPopupState, type ShellDialog, type ShellToast, type StepInspectorPopupLine, type StepInspectorPopupState, type TuiArtifact } from "./types.js";
import { type MouseEvent as TuiMouseEvent } from "@opentui/core";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { For, Show } from "solid-js";
import { promptFileViewerContentWidth, promptFileViewerDialogWidth, promptFileViewerFiletype, promptFileViewerMaxVisibleRows, PromptFileViewerScrollbar, promptFileViewerWrappedLines } from "./dialog-file-viewer-utils.js";
import { stepInspectorPopupActionLineIndexes, stepInspectorPopupContentWidth, stepInspectorPopupHeight, stepInspectorPopupLineColor, stepInspectorPopupVisibleRows, stepInspectorPopupWidth, stepInspectorPopupWrappedLines } from "./dialog-inspector-utils.js";
import { artifactDisplayPath, resultPopupContentWidth, resultPopupHeight, resultPopupVisibleRows, resultPopupWidth, resultPopupWrappedLines } from "./result-artifact-utils.js";

export { PromptFileViewerScrollbar, promptFileViewerScrollbarThumb, promptFileViewerDialogWidth, promptFileViewerContentWidth, promptFileViewerMaxVisibleRows, promptFileViewerFiletype, promptFileViewerViewportRows, promptFileViewerWrappedLines, promptFileViewerMaxScrollOffset } from "./dialog-file-viewer-utils.js";
export { stepInspectorPopupWidth, stepInspectorPopupHeight, stepInspectorPopupContentWidth, stepInspectorPopupVisibleRows, stepInspectorPopupWrappedLines, stepInspectorPopupActionLineIndexes, firstStepInspectorPopupActionLineIndex, stepInspectorPopupWrappedIndexForLine, stepInspectorPopupMaxScrollOffset, stepInspectorPopupLineColor } from "./dialog-inspector-utils.js";
export { resultPopupWidth, resultPopupHeight, resultPopupContentWidth, resultPopupVisibleRows, resultPopupWrappedLines, resultPopupMaxScrollOffset, resultArtifactName, selectedArtifactFor, artifactContent, readArtifactText, isTextArtifact, artifactDisplayPath, artifactDirectoryDisplay } from "./result-artifact-utils.js";


export function ShellDialogView(props: {
  dialog: ShellDialog;
}) {
  return (
    <box
      backgroundColor={THEME.backgroundPanel}
      border={["top", "right", "bottom", "left"]}
      borderColor={props.dialog.variant === "error" ? THEME.error : props.dialog.variant === "confirm" ? THEME.warning : THEME.borderActive}
      flexDirection="column"
      left={8}
      paddingBottom={1}
      paddingLeft={1}
      paddingTop={1}
      position="absolute"
      top={5}
      width={66}
    >
      <text fg={props.dialog.variant === "error" ? THEME.error : props.dialog.variant === "confirm" ? THEME.warning : THEME.accent}>
        {props.dialog.title}
      </text>
      <text fg={THEME.text}>{truncate(props.dialog.message, 62)}</text>
      <text fg={THEME.muted}>
        {props.dialog.variant === "confirm"
          ? props.dialog.confirmOnInterrupt ? "enter or ctrl+c confirm · esc cancel" : "enter confirm · esc cancel"
          : "enter close · esc close"}
      </text>
    </box>
  );
}

export function ConfigValueEditorDialog(props: {
  editor: ConfigValueEditor;
  terminalWidth: number;
}) {
  const width = () => Math.min(88, Math.max(40, props.terminalWidth - 12));
  const valueWidth = () => Math.max(24, width() - 4);
  const valueLines = () => wrappedValueLines(props.editor.draft || " ", valueWidth(), 8);
  const targetLabel = () => props.editor.saveTarget === "config"
    ? `config file ${props.editor.configPath ?? "-"}`
    : "request draft";
  const targetColor = () => props.editor.saveTarget === "config" ? THEME.info : THEME.accent;
  return (
    <box
      backgroundColor={THEME.backgroundPanel}
      border={["top", "right", "bottom", "left"]}
      borderColor={THEME.borderActive}
      flexDirection="column"
      left={Math.max(2, Math.floor((props.terminalWidth - width()) / 2))}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      position="absolute"
      top={5}
      width={width()}
    >
      <text fg={THEME.accent} height={1} truncate={true}>
        Edit configuration value
      </text>
      <text fg={THEME.text} height={1} truncate={true}>
        {props.editor.field.label ?? props.editor.field.id}
      </text>
      <box flexDirection="row" height={1}>
        <text fg={THEME.muted} height={1} truncate={true}>
          {`input ${props.editor.field.inputKey ?? props.editor.field.id} · save target `}
        </text>
        <text fg={targetColor()} flexGrow={1} height={1} truncate={true}>
          {targetLabel()}
        </text>
      </box>
      <box border={["top", "right", "bottom", "left"]} borderColor={THEME.border} flexDirection="column" marginTop={1} paddingLeft={1}>
        <For each={valueLines()}>
          {(line) => (
            <text fg={THEME.info} height={1} truncate={true}>
              {line}
            </text>
          )}
        </For>
      </box>
      <text fg={THEME.muted} height={1} truncate={true}>
        type edit · paste append · tab target · enter save · esc cancel
      </text>
    </box>
  );
}

export function PromptFileViewerDialog(props: {
  scrollOffset: number;
  terminalHeight: number;
  terminalWidth: number;
  viewer: PromptFileViewer;
  onScroll(direction: "down" | "left" | "right" | "up"): void;
}) {
  const width = () => promptFileViewerDialogWidth(props.terminalWidth);
  const contentWidth = () => promptFileViewerContentWidth(props.terminalWidth);
  const maxVisibleRows = () => promptFileViewerMaxVisibleRows(props.terminalHeight);
  const wrappedLines = () => promptFileViewerWrappedLines(props.viewer, contentWidth());
  const visibleRows = () => Math.max(1, Math.min(maxVisibleRows(), wrappedLines().length));
  const maxOffset = () => Math.max(0, wrappedLines().length - visibleRows());
  const scrollOffset = () => clampNumber(props.scrollOffset, 0, maxOffset());
  const scrollable = () => wrappedLines().length > visibleRows();
  const visibleStart = () => wrappedLines().length === 0 ? 0 : scrollOffset() + 1;
  const visibleEnd = () => Math.min(wrappedLines().length, scrollOffset() + visibleRows());
  const visibleLines = () => wrappedLines().slice(scrollOffset(), scrollOffset() + visibleRows());
  const filetype = () => promptFileViewerFiletype(props.viewer.path);
  const visibleContent = () => visibleLines().join("\n");
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
      left={Math.max(2, Math.floor((props.terminalWidth - width()) / 2))}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      position="absolute"
      top={4}
      width={width()}
      onMouseScroll={handleMouseScroll}
    >
      <text fg={THEME.accent} height={1} truncate={true}>
        {props.viewer.title ?? "File viewer"}
      </text>
      <text fg={THEME.muted} height={1} truncate={true}>
        {props.viewer.displayPath}
      </text>
      <box
        border={["top", "right", "bottom", "left"]}
        borderColor={THEME.border}
        flexDirection="row"
        height={visibleRows() + 2}
        marginTop={1}
        overflow="hidden"
      >
        <box flexDirection="column" flexGrow={1} minWidth={0} paddingLeft={1}>
          <code
            content={visibleContent()}
            drawUnstyledText={true}
            fg={THEME.text}
            filetype={filetype()}
            height={visibleRows()}
            syntaxStyle={getWorkflowTuiSyntaxStyle()}
            truncate={true}
            width="100%"
          />
        </box>
        <Show when={scrollable()}>
          <PromptFileViewerScrollbar
            offset={scrollOffset()}
            totalRows={wrappedLines().length}
            visibleRows={visibleRows()}
          />
        </Show>
      </box>
      <text fg={THEME.muted} height={1} truncate={true}>
        {scrollable()
          ? `${visibleStart()}-${visibleEnd()} of ${wrappedLines().length} · up/down pageup/pagedown home/end · enter close · esc close`
          : "enter close · esc close"}
      </text>
    </box>
  );
}

export function ResultArtifactPopup(props: {
  popup: ResultArtifactPopupState;
  scrollOffset: number;
  terminalHeight: number;
  terminalWidth: number;
}) {
  const width = () => resultPopupWidth(props.terminalWidth);
  const height = () => resultPopupHeight(props.terminalHeight);
  const contentWidth = () => resultPopupContentWidth(props.terminalWidth);
  const visibleRows = () => resultPopupVisibleRows(props.popup, props.terminalHeight);
  const wrappedLines = () => resultPopupWrappedLines(props.popup, contentWidth());
  const maxOffset = () => Math.max(0, wrappedLines().length - visibleRows());
  const scrollOffset = () => clampNumber(props.scrollOffset, 0, maxOffset());
  const scrollable = () => wrappedLines().length > visibleRows();
  const visibleStart = () => wrappedLines().length === 0 ? 0 : scrollOffset() + 1;
  const visibleEnd = () => Math.min(wrappedLines().length, scrollOffset() + visibleRows());
  const visibleLines = () => wrappedLines().slice(scrollOffset(), scrollOffset() + visibleRows());
  return (
    <box
      backgroundColor={THEME.backgroundPanel}
      border={["top", "right", "bottom", "left"]}
      borderColor={THEME.borderActive}
      flexDirection="column"
      height={height()}
      left={0}
      overflow="hidden"
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      position="absolute"
      top={0}
      width={width()}
    >
      <box flexDirection="row" height={1}>
        <text fg={THEME.accent} flexGrow={1} height={1} truncate={true}>
          Result Artifact
        </text>
        <text fg={THEME.muted} height={1} truncate={true}>
          esc close
        </text>
      </box>
      <text fg={props.popup.error ? THEME.error : THEME.success} height={1} truncate={true}>
        {props.popup.name}
      </text>
      <Show when={props.popup.artifact?.path}>
        {(artifactPath) => (
          <text fg={THEME.muted} height={1} truncate={true}>
            {artifactDisplayPath(artifactPath())}
          </text>
        )}
      </Show>
      <box
        border={["top", "right", "bottom", "left"]}
        borderColor={THEME.border}
        flexDirection="row"
        flexGrow={1}
        marginTop={1}
        minHeight={0}
        overflow="hidden"
      >
        <box flexDirection="column" flexGrow={1} minWidth={0} paddingLeft={1} paddingRight={1}>
          <For each={visibleLines()}>
            {(line) => (
              <text fg={props.popup.error ? THEME.error : THEME.text} height={1} truncate={true}>
                {line}
              </text>
            )}
          </For>
        </box>
        <Show when={scrollable()}>
          <PromptFileViewerScrollbar
            offset={scrollOffset()}
            totalRows={wrappedLines().length}
            visibleRows={visibleRows()}
          />
        </Show>
      </box>
      <text fg={THEME.muted} height={1} truncate={true}>
        {scrollable()
          ? `${visibleStart()}-${visibleEnd()} of ${wrappedLines().length} · up/down pageup/pagedown home/end · enter close · esc close`
          : "enter close · esc close"}
      </text>
    </box>
  );
}

export function StepInspectorPopup(props: {
  popup: StepInspectorPopupState;
  scrollOffset: number;
  selectedLineIndex: number;
  terminalHeight: number;
  terminalWidth: number;
}) {
  const width = () => stepInspectorPopupWidth(props.terminalWidth);
  const height = () => stepInspectorPopupHeight(props.terminalHeight);
  const contentWidth = () => stepInspectorPopupContentWidth(props.terminalWidth);
  const visibleRows = () => stepInspectorPopupVisibleRows(props.terminalHeight);
  const wrappedLines = () => stepInspectorPopupWrappedLines(props.popup, contentWidth());
  const maxOffset = () => Math.max(0, wrappedLines().length - visibleRows());
  const scrollOffset = () => clampNumber(props.scrollOffset, 0, maxOffset());
  const scrollable = () => wrappedLines().length > visibleRows();
  const visibleStart = () => wrappedLines().length === 0 ? 0 : scrollOffset() + 1;
  const visibleEnd = () => Math.min(wrappedLines().length, scrollOffset() + visibleRows());
  const visibleLines = () => wrappedLines().slice(scrollOffset(), scrollOffset() + visibleRows());
  return (
    <box
      backgroundColor={THEME.backgroundPanel}
      border={["top", "right", "bottom", "left"]}
      borderColor={THEME.borderActive}
      flexDirection="column"
      height={height()}
      left={Math.max(0, Math.floor((props.terminalWidth - width()) / 2))}
      overflow="hidden"
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      position="absolute"
      top={Math.max(0, Math.floor((props.terminalHeight - height()) / 2))}
      width={width()}
    >
      <box flexDirection="row" height={1}>
        <text fg={THEME.accent} flexGrow={1} height={1} truncate={true}>
          {props.popup.title}
        </text>
        <text fg={THEME.muted} height={1} truncate={true}>
          esc close
        </text>
      </box>
      <text fg={THEME.muted} height={1} truncate={true}>
        Input · Output · Criteria · Evidence · Prompt files · Events
      </text>
      <box
        border={["top", "right", "bottom", "left"]}
        borderColor={THEME.border}
        flexDirection="row"
        flexGrow={1}
        marginTop={1}
        minHeight={0}
        overflow="hidden"
      >
        <box flexDirection="column" flexGrow={1} minWidth={0} paddingLeft={1} paddingRight={1}>
          <For each={visibleLines()}>
            {(line) => {
              const selected = () => line.lineIndex === props.selectedLineIndex && Boolean(line.line.action);
              const marker = () => line.line.action ? (selected() ? "› " : "  ") : "";
              return (
                <box backgroundColor={selected() ? THEME.selected : undefined} flexDirection="row" height={1}>
                  <text
                    fg={selected() ? THEME.accent : stepInspectorPopupLineColor(line.line.text)}
                    flexGrow={1}
                    height={1}
                    truncate={true}
                  >
                    {paintDisplaySpaces(`${marker()}${line.text}`)}
                  </text>
                </box>
              );
            }}
          </For>
        </box>
        <Show when={scrollable()}>
          <PromptFileViewerScrollbar
            offset={scrollOffset()}
            totalRows={wrappedLines().length}
            visibleRows={visibleRows()}
          />
        </Show>
      </box>
      <text fg={THEME.muted} height={1} truncate={true}>
        {scrollable()
          ? `${visibleStart()}-${visibleEnd()} of ${wrappedLines().length} · ↑↓ openable · pageup/pagedown scroll · enter open/close · esc close`
          : stepInspectorPopupActionLineIndexes(props.popup.lines).length > 0
          ? "↑↓ openable · enter open selected · esc close"
          : "enter close · esc close"}
      </text>
    </box>
  );
}

export function ShellToastView(props: {
  left: number;
  toast: ShellToast;
  width: number;
}) {
  const accent = () => {
    if (props.toast.variant === "error") return THEME.error;
    if (props.toast.variant === "success") return THEME.success;
    if (props.toast.variant === "warning") return THEME.warning;
    return THEME.info;
  };
  return (
    <box
      backgroundColor={THEME.backgroundPanel}
      border={["left", "right"]}
      borderColor={accent()}
      flexDirection="column"
      left={props.left}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      position="absolute"
      top={2}
      width={props.width}
    >
      <Show when={props.toast.title}>
        {(title) => <text fg={THEME.text} height={1} truncate={true}>{title()}</text>}
      </Show>
      <text fg={THEME.text} height={1} truncate={true}>
        {props.toast.message}
      </text>
    </box>
  );
}

export function toastWidth(terminalWidth: number) {
  return Math.min(60, Math.max(12, terminalWidth - 6));
}

export function toastLeft(terminalWidth: number) {
  return Math.max(2, terminalWidth - toastWidth(terminalWidth) - 4);
}
