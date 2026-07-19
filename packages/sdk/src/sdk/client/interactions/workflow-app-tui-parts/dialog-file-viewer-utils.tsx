/** @jsxImportSource @opentui/solid */
import { clampNumber } from "./command-palette.js";
import { wrapLine } from "./config-utils.js";
import { THEME } from "./style.js";
import { type PromptFileViewer } from "./types.js";
import * as path from "node:path";
import { For } from "solid-js";

export function PromptFileViewerScrollbar(props: {
  offset: number;
  totalRows: number;
  visibleRows: number;
}) {
  const thumb = () => promptFileViewerScrollbarThumb(props.totalRows, props.visibleRows, props.offset);
  return (
    <box flexDirection="column" flexShrink={0} width={1}>
      <For each={Array.from({ length: props.visibleRows })}>
        {(_, index) => {
          const active = () => index() >= thumb().start && index() < thumb().end;
          return (
            <text fg={active() ? THEME.text : THEME.border} height={1} width={1}>
              {active() ? "█" : "│"}
            </text>
          );
        }}
      </For>
    </box>
  );
}

export function promptFileViewerScrollbarThumb(totalRows: number, visibleRows: number, offset: number) {
  if (totalRows <= visibleRows) return { end: visibleRows, start: 0 };
  const size = Math.max(1, Math.round((visibleRows / totalRows) * visibleRows));
  const maxStart = Math.max(0, visibleRows - size);
  const maxOffset = Math.max(1, totalRows - visibleRows);
  const start = clampNumber(Math.round((offset / maxOffset) * maxStart), 0, maxStart);
  return {
    end: Math.min(visibleRows, start + size),
    start,
  };
}

export function promptFileViewerDialogWidth(terminalWidth: number) {
  return Math.min(100, Math.max(48, terminalWidth - 12));
}

export function promptFileViewerContentWidth(terminalWidth: number) {
  return Math.max(24, promptFileViewerDialogWidth(terminalWidth) - 6);
}

export function promptFileViewerMaxVisibleRows(terminalHeight: number) {
  return Math.max(3, Math.min(18, terminalHeight - 12));
}

export function promptFileViewerFiletype(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".md":
    case ".markdown":
      return "markdown";
    case ".json":
    case ".jsonc":
      return "json";
    case ".zig":
      return "zig";
    default:
      return undefined;
  }
}

export function promptFileViewerViewportRows(viewer: PromptFileViewer, terminalWidth: number, terminalHeight: number) {
  return Math.max(1, Math.min(
    promptFileViewerMaxVisibleRows(terminalHeight),
    promptFileViewerWrappedLines(viewer, promptFileViewerContentWidth(terminalWidth)).length,
  ));
}

export function promptFileViewerWrappedLines(viewer: PromptFileViewer, contentWidth: number) {
  return viewer.content
    .split("\n")
    .flatMap((line) => wrapLine(line || " ", contentWidth));
}

export function promptFileViewerMaxScrollOffset(viewer: PromptFileViewer, terminalWidth: number, visibleRows: number) {
  return Math.max(0, promptFileViewerWrappedLines(
    viewer,
    promptFileViewerContentWidth(terminalWidth),
  ).length - visibleRows);
}
