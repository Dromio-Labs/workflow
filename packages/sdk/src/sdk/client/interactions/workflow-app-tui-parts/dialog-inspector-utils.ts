import { wrapLine } from "./config-utils.js";
import { THEME } from "./style.js";
import { type StepInspectorPopupLine, type StepInspectorPopupState } from "./types.js";

export function stepInspectorPopupWidth(terminalWidth: number) {
  return Math.min(Math.max(72, terminalWidth - 12), 132);
}

export function stepInspectorPopupHeight(terminalHeight: number) {
  return Math.min(Math.max(16, terminalHeight - 8), 38);
}

export function stepInspectorPopupContentWidth(terminalWidth: number) {
  return Math.max(24, stepInspectorPopupWidth(terminalWidth) - 7);
}

export function stepInspectorPopupVisibleRows(terminalHeight: number) {
  return Math.max(1, stepInspectorPopupHeight(terminalHeight) - 7);
}

export function stepInspectorPopupWrappedLines(popup: StepInspectorPopupState, contentWidth: number) {
  return popup.lines.flatMap((line, lineIndex) => {
    const prefixWidth = line.action ? 2 : 0;
    return wrapLine(line.text || " ", Math.max(1, contentWidth - prefixWidth)).map((text) => ({
      line,
      lineIndex,
      text,
    }));
  });
}

export function stepInspectorPopupActionLineIndexes(lines: StepInspectorPopupLine[]) {
  return lines.flatMap((line, index) => line.action ? [index] : []);
}

export function firstStepInspectorPopupActionLineIndex(lines: StepInspectorPopupLine[]) {
  const promptFileIndex = lines.findIndex((line) => line.action?.kind === "promptFile");
  if (promptFileIndex >= 0) return promptFileIndex;
  return stepInspectorPopupActionLineIndexes(lines)[0] ?? 0;
}

export function stepInspectorPopupWrappedIndexForLine(
  popup: StepInspectorPopupState,
  lineIndex: number,
  contentWidth: number,
) {
  return stepInspectorPopupWrappedLines(popup, contentWidth)
    .findIndex((line) => line.lineIndex === lineIndex);
}

export function stepInspectorPopupMaxScrollOffset(
  popup: StepInspectorPopupState,
  terminalWidth: number,
  visibleRows: number,
) {
  return Math.max(0, stepInspectorPopupWrappedLines(
    popup,
    stepInspectorPopupContentWidth(terminalWidth),
  ).length - visibleRows);
}

export function stepInspectorPopupLineColor(line: string) {
  if (/^(Input|Output|Criteria|Evidence|Prompt files and model prompts|Events)$/.test(line)) return THEME.accent;
  if (line.includes("missing") || line.includes("blocked") || line.includes("stale")) return THEME.warning;
  if (line.includes("satisfied") || line.includes("available") || line.includes("completed")) return THEME.success;
  if (line.startsWith("Step:")) return THEME.info;
  return THEME.text;
}
