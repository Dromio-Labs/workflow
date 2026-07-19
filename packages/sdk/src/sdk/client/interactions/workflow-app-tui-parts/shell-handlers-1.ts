import { snapshotWorkflowAppRun, type WorkflowAppRunSnapshot } from "../workflow-app.js";
import { clampNumber } from "./command-palette.js";
import { promptFileViewerMaxScrollOffset, promptFileViewerViewportRows, stepInspectorPopupActionLineIndexes, stepInspectorPopupContentWidth, stepInspectorPopupMaxScrollOffset, stepInspectorPopupVisibleRows, stepInspectorPopupWrappedIndexForLine } from "./dialogs-popups.js";
import { clampIndex, deletePreviousWord, isDeletePreviousWordKey, isDownKey, isEndKey, isEscapeKey, isHomeKey, isPageDownKey, isPageUpKey, isReturnKey, isUpKey, keyMatches } from "./routing-keyboard.js";
import { filteredWorkflowSessionRuns, normalizeWorkflowSessionListPosition, workflowSessionListVisibleCount } from "./session-dialog.js";
import { type StepInspectorPopupState } from "./types.js";
import { type KeyEvent } from "@opentui/core";
import * as path from "node:path";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellHandlerContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellHandlers1(ctx: WorkflowAppTuiShellHandlerContext) {

  function commandKey(event: KeyEvent, binding: string) {
    let { keymap, leaderForKey } = ctx();
      return keyMatches(event, binding, {
        leader: keymap.leader,
        leaderActive: leaderForKey,
      });
    }

  function openWorkflowSessions() {
    let { loadWorkflowSessions, selectedWorkflowId, setSessionListDialog } = ctx();
      const workflowId = selectedWorkflowId();
      setSessionListDialog({
        loading: true,
        query: "",
        runs: [],
        scrollOffset: 0,
        selectedIndex: 0,
        workflowId,
      });
      void loadWorkflowSessions(workflowId);
    }

  async function loadWorkflowSessions(workflowId: string) {
    let { dimensions, liveWorkflowRunSnapshots, props, setSessionListDialog } = ctx();
      let error: string | undefined;
      let runs: WorkflowAppRunSnapshot[] = [];
      try {
        if (props.controlPlane) {
          runs = await props.controlPlane.listRuns({ workflowId });
        } else {
          runs = liveWorkflowRunSnapshots(workflowId);
        }
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        runs = liveWorkflowRunSnapshots(workflowId);
      }
      setSessionListDialog((current: any) => {
        if (!current || current.workflowId !== workflowId) return current;
        return {
          ...current,
          error,
          loading: false,
          runs,
          ...normalizeWorkflowSessionListPosition({
            ...current,
            runs,
          }, workflowSessionListVisibleCount(current, dimensions().height)),
        };
      });
    }

  function liveWorkflowRunSnapshots(workflowId: string) {
    let { props } = ctx();
      return props.runtime.listRuns()
        .filter((run: any) => run.workflowId === workflowId)
        .map((run: any) => snapshotWorkflowAppRun(props.app, run))
        .reverse();
    }

  function handleSessionListDialogKey(event: KeyEvent) {
    let { dimensions, moveWorkflowSessionListSelection, sessionListDialog, setSessionListDialog, viewRunSnapshot } = ctx();
      const state = sessionListDialog();
      if (!state) return;
      if (isEscapeKey(event)) {
        event.preventDefault();
        setSessionListDialog(undefined);
        return;
      }
      if (event.name === "up" || event.name === "down") {
        event.preventDefault();
        const delta = event.name === "up" ? -1 : 1;
        moveWorkflowSessionListSelection(delta);
        return;
      }
      if (isPageUpKey(event) || isPageDownKey(event)) {
        event.preventDefault();
        const visibleCount = workflowSessionListVisibleCount(state, dimensions().height);
        moveWorkflowSessionListSelection(isPageUpKey(event) ? -visibleCount : visibleCount);
        return;
      }
      if (isHomeKey(event) || isEndKey(event)) {
        event.preventDefault();
        setSessionListDialog((current: any) => {
          if (!current) return current;
          const rows = filteredWorkflowSessionRuns(current.runs, current.query);
          const position = normalizeWorkflowSessionListPosition({
            ...current,
            selectedIndex: isHomeKey(event) ? 0 : Math.max(0, rows.length - 1),
          }, workflowSessionListVisibleCount(current, dimensions().height));
          return { ...current, ...position };
        });
        return;
      }
      if (isReturnKey(event)) {
        event.preventDefault();
        const rows = filteredWorkflowSessionRuns(state.runs, state.query);
        const run = rows[clampIndex(state.selectedIndex, rows.length)];
        if (!run) return;
        setSessionListDialog(undefined);
        viewRunSnapshot(run);
        return;
      }
      if (isDeletePreviousWordKey(event)) {
        event.preventDefault();
        setSessionListDialog((current: any) => current
          ? { ...current, query: deletePreviousWord(current.query), scrollOffset: 0, selectedIndex: 0 }
          : current);
        return;
      }
      if (event.name === "backspace") {
        event.preventDefault();
        setSessionListDialog((current: any) => current
          ? { ...current, query: current.query.slice(0, -1), scrollOffset: 0, selectedIndex: 0 }
          : current);
        return;
      }
      if (!event.ctrl && !event.meta && event.sequence && event.sequence.length === 1) {
        event.preventDefault();
        setSessionListDialog((current: any) => current
          ? { ...current, query: current.query + event.sequence, scrollOffset: 0, selectedIndex: 0 }
          : current);
      }
    }

  function moveWorkflowSessionListSelection(delta: number) {
    let { dimensions, setSessionListDialog } = ctx();
      setSessionListDialog((current: any) => {
        if (!current) return current;
        const position = normalizeWorkflowSessionListPosition({
          ...current,
          selectedIndex: current.selectedIndex + delta,
        }, workflowSessionListVisibleCount(current, dimensions().height));
        return { ...current, ...position };
      });
    }

  function scrollWorkflowSessions(direction: "down" | "left" | "right" | "up") {
    let { dimensions, setSessionListDialog } = ctx();
      if (direction !== "up" && direction !== "down") return;
      setSessionListDialog((current: any) => {
        if (!current) return current;
        const visibleCount = workflowSessionListVisibleCount(current, dimensions().height);
        const rows = filteredWorkflowSessionRuns(current.runs, current.query);
        const nextScrollOffset = clampNumber(
          current.scrollOffset + (direction === "down" ? 3 : -3),
          0,
          Math.max(0, rows.length - visibleCount),
        );
        const selectedIndex = clampNumber(
          current.selectedIndex,
          nextScrollOffset,
          Math.max(nextScrollOffset, Math.min(rows.length - 1, nextScrollOffset + visibleCount - 1)),
        );
        return {
          ...current,
          scrollOffset: nextScrollOffset,
          selectedIndex,
        };
      });
    }

  function handleDialogKey(event: KeyEvent) {
    let { dialog, setDialog } = ctx();
      if (isEscapeKey(event)) {
        event.preventDefault();
        setDialog(undefined);
        return;
      }
      if (isReturnKey(event)) {
        event.preventDefault();
        const current = dialog();
        setDialog(undefined);
        current?.confirm?.();
      }
    }

  function handlePromptFileViewerKey(event: KeyEvent) {
    let { dimensions, promptFileViewer, setPromptFileViewer, setPromptFileViewerScrollOffset } = ctx();
      if (isEscapeKey(event) || isReturnKey(event)) {
        event.preventDefault();
        setPromptFileViewer(undefined);
        setPromptFileViewerScrollOffset(0);
        return;
      }
      const viewer = promptFileViewer();
      if (!viewer) return;
      const visibleRows = promptFileViewerViewportRows(viewer, dimensions().width, dimensions().height);
      const maxOffset = promptFileViewerMaxScrollOffset(viewer, dimensions().width, visibleRows);
      const pageSize = Math.max(1, visibleRows - 1);
      if (isUpKey(event)) {
        event.preventDefault();
        setPromptFileViewerScrollOffset((offset: number) => clampNumber(offset - 1, 0, maxOffset));
        return;
      }
      if (isDownKey(event)) {
        event.preventDefault();
        setPromptFileViewerScrollOffset((offset: number) => clampNumber(offset + 1, 0, maxOffset));
        return;
      }
      if (isPageUpKey(event)) {
        event.preventDefault();
        setPromptFileViewerScrollOffset((offset: number) => clampNumber(offset - pageSize, 0, maxOffset));
        return;
      }
      if (isPageDownKey(event)) {
        event.preventDefault();
        setPromptFileViewerScrollOffset((offset: number) => clampNumber(offset + pageSize, 0, maxOffset));
        return;
      }
      if (isHomeKey(event)) {
        event.preventDefault();
        setPromptFileViewerScrollOffset(0);
        return;
      }
      if (isEndKey(event)) {
        event.preventDefault();
        setPromptFileViewerScrollOffset(maxOffset);
      }
    }

  function handleStepInspectorPopupKey(event: KeyEvent) {
    let { closeStepInspectorPopup, dimensions, moveStepInspectorPopupSelection, openSelectedStepInspectorPopupLine, setStepInspectorPopupScrollOffset, stepInspectorPopup } = ctx();
      if (isEscapeKey(event)) {
        event.preventDefault();
        closeStepInspectorPopup();
        return;
      }
      const popup = stepInspectorPopup();
      if (!popup) return;
      const visibleRows = stepInspectorPopupVisibleRows(dimensions().height);
      const maxOffset = stepInspectorPopupMaxScrollOffset(popup, dimensions().width, visibleRows);
      const pageSize = Math.max(1, visibleRows - 1);
      if (isReturnKey(event)) {
        event.preventDefault();
        if (openSelectedStepInspectorPopupLine()) return;
        closeStepInspectorPopup();
        return;
      }
      if (isUpKey(event)) {
        event.preventDefault();
        if (!moveStepInspectorPopupSelection(-1)) {
          setStepInspectorPopupScrollOffset((offset: number) => clampNumber(offset - 1, 0, maxOffset));
        }
        return;
      }
      if (isDownKey(event)) {
        event.preventDefault();
        if (!moveStepInspectorPopupSelection(1)) {
          setStepInspectorPopupScrollOffset((offset: number) => clampNumber(offset + 1, 0, maxOffset));
        }
        return;
      }
      if (isPageUpKey(event)) {
        event.preventDefault();
        setStepInspectorPopupScrollOffset((offset: number) => clampNumber(offset - pageSize, 0, maxOffset));
        return;
      }
      if (isPageDownKey(event)) {
        event.preventDefault();
        setStepInspectorPopupScrollOffset((offset: number) => clampNumber(offset + pageSize, 0, maxOffset));
        return;
      }
      if (isHomeKey(event)) {
        event.preventDefault();
        setStepInspectorPopupScrollOffset(0);
        return;
      }
      if (isEndKey(event)) {
        event.preventDefault();
        setStepInspectorPopupScrollOffset(maxOffset);
      }
    }

  function closeStepInspectorPopup() {
    let { setStepInspectorPopup, setStepInspectorPopupScrollOffset, setStepInspectorPopupSelectedLineIndex } = ctx();
      setStepInspectorPopup(undefined);
      setStepInspectorPopupScrollOffset(0);
      setStepInspectorPopupSelectedLineIndex(0);
    }

  function openSelectedStepInspectorPopupLine() {
    let { openPromptFileViewer, setPromptFileViewer, setPromptFileViewerScrollOffset, stepInspectorPopup, stepInspectorPopupSelectedLineIndex } = ctx();
      const popup = stepInspectorPopup();
      const line = popup?.lines[stepInspectorPopupSelectedLineIndex()];
      if (!line?.action) return false;
      if (line.action.kind === "promptFile") {
        openPromptFileViewer(line.action.path);
        return true;
      }
      if (line.action.kind === "content") {
        setPromptFileViewerScrollOffset(0);
        setPromptFileViewer({
          content: line.action.content,
          displayPath: line.action.displayPath,
          path: line.action.path,
          title: line.action.title,
        });
        return true;
      }
      return false;
    }

  function moveStepInspectorPopupSelection(delta: number) {
    let { keepStepInspectorPopupLineVisible, setStepInspectorPopupSelectedLineIndex, stepInspectorPopup, stepInspectorPopupSelectedLineIndex } = ctx();
      const popup = stepInspectorPopup();
      if (!popup) return false;
      const indexes = stepInspectorPopupActionLineIndexes(popup.lines);
      if (indexes.length === 0) return false;
      const current = stepInspectorPopupSelectedLineIndex();
      const currentIndex = indexes.includes(current) ? indexes.indexOf(current) : 0;
      const nextLineIndex = indexes[(currentIndex + delta + indexes.length) % indexes.length]!;
      setStepInspectorPopupSelectedLineIndex(nextLineIndex);
      keepStepInspectorPopupLineVisible(popup, nextLineIndex);
      return true;
    }

  function keepStepInspectorPopupLineVisible(popup: StepInspectorPopupState, lineIndex: number) {
    let { dimensions, setStepInspectorPopupScrollOffset } = ctx();
      const visibleRows = stepInspectorPopupVisibleRows(dimensions().height);
      const wrappedIndex = stepInspectorPopupWrappedIndexForLine(
        popup,
        lineIndex,
        stepInspectorPopupContentWidth(dimensions().width),
      );
      if (wrappedIndex < 0) return;
      setStepInspectorPopupScrollOffset((offset: number) => {
        if (wrappedIndex < offset) return wrappedIndex;
        if (wrappedIndex >= offset + visibleRows) return Math.max(0, wrappedIndex - visibleRows + 1);
        return offset;
      });
    }

  function scrollPromptFileViewer(direction: "down" | "left" | "right" | "up") {
    let { dimensions, promptFileViewer, setPromptFileViewerScrollOffset } = ctx();
      const viewer = promptFileViewer();
      if (!viewer || (direction !== "down" && direction !== "up")) return;
      const visibleRows = promptFileViewerViewportRows(viewer, dimensions().width, dimensions().height);
      const maxOffset = promptFileViewerMaxScrollOffset(viewer, dimensions().width, visibleRows);
      const step = Math.max(1, Math.floor(visibleRows / 3));
      const delta = direction === "down" ? step : -step;
      setPromptFileViewerScrollOffset((offset: number) => clampNumber(offset + delta, 0, maxOffset));
    }

  function handleMetadataPopupKey(event: KeyEvent) {
    let { openConfigValueEditor, openPromptFileViewer, selectedMetadataPromptRowIndex, selectedMetadataRows, setMetadataPopupOpen, setSelectedMetadataPromptRowIndex } = ctx();
      if (isEscapeKey(event)) {
        event.preventDefault();
        setMetadataPopupOpen(false);
        return;
      }
      const rows = selectedMetadataRows();
      if (isUpKey(event) && rows.length > 0) {
        event.preventDefault();
        setSelectedMetadataPromptRowIndex((index: number) => clampIndex(index - 1, rows.length));
        return;
      }
      if (isDownKey(event) && rows.length > 0) {
        event.preventDefault();
        setSelectedMetadataPromptRowIndex((index: number) => clampIndex(index + 1, rows.length));
        return;
      }
      if (isReturnKey(event)) {
        event.preventDefault();
        const row = rows[clampIndex(selectedMetadataPromptRowIndex(), rows.length)];
        if (row?.kind === "file" && row.path) {
          openPromptFileViewer(row.path);
          return;
        }
        if (row?.kind === "config") {
          openConfigValueEditor(row.field);
        }
      }
    }

  return { commandKey, openWorkflowSessions, loadWorkflowSessions, liveWorkflowRunSnapshots, handleSessionListDialogKey, moveWorkflowSessionListSelection, scrollWorkflowSessions, handleDialogKey, handlePromptFileViewerKey, handleStepInspectorPopupKey, closeStepInspectorPopup, openSelectedStepInspectorPopupLine, moveStepInspectorPopupSelection, keepStepInspectorPopupLineVisible, scrollPromptFileViewer, handleMetadataPopupKey };
}
