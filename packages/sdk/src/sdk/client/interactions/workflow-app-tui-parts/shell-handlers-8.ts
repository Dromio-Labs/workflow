import { type WorkflowAppRun, type WorkflowAppRunSnapshot } from "../workflow-app.js";
import { createWorkflowRunStore, type WorkflowRunStore } from "../workflow-run-store.js";
import { clampNumber } from "./command-palette.js";
import { resultPopupMaxScrollOffset, resultPopupVisibleRows } from "./dialogs-popups.js";
import { deletePreviousWord, isDeletePreviousWordKey, isDownKey, isEndKey, isEscapeKey, isHomeKey, isLeftKey, isPageDownKey, isPageUpKey, isReturnKey, isRightKey, isUpKey } from "./routing-keyboard.js";
import { formatTuiRunResult, shellStatus } from "./runtime-utils.js";
import { type KeyEvent } from "@opentui/core";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellHandlerContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellHandlers8(ctx: WorkflowAppTuiShellHandlerContext) {

  function handleRunKey(event: KeyEvent) {
    const {
      handleStepDetailTreeKey, navigateBackFromRoute, navigateStart, openResultPopup,
      replacePromptDraft, route, setSelectedSidebarTab, status, viewedRun,
    } = ctx();
    if (isEscapeKey(event)) {
      event.preventDefault();
      navigateBackFromRoute(route());
      return;
    }
    if (route().type === "run") {
      if (isLeftKey(event)) {
        event.preventDefault();
        setSelectedSidebarTab("config");
        return;
      }
      if (isRightKey(event)) {
        event.preventDefault();
        setSelectedSidebarTab("activity");
        return;
      }
    }
    if (route().type === "step" && handleStepDetailTreeKey(event)) return;
    if (isReturnKey(event) && status() === "completed") {
      event.preventDefault();
      openResultPopup(undefined);
      return;
    }
    if (event.sequence?.toLowerCase() === "r") {
      event.preventDefault();
      const run = viewedRun();
      if (run?.input) {
        replacePromptDraft(run.input);
        navigateStart(run.workflowId);
      }
    }
  }

  function handleResultPopupKey(event: KeyEvent) {
    let { dimensions, resultPopup, setResultPopup, setResultPopupScrollOffset } = ctx();
      if (isEscapeKey(event) || isReturnKey(event)) {
        event.preventDefault();
        setResultPopup(undefined);
        setResultPopupScrollOffset(0);
        return;
      }
      const popup = resultPopup();
      if (!popup) return;
      const visibleRows = resultPopupVisibleRows(popup, dimensions().height);
      const maxOffset = resultPopupMaxScrollOffset(popup, dimensions().width, visibleRows);
      const pageSize = Math.max(1, visibleRows - 1);
      if (isUpKey(event)) {
        event.preventDefault();
        setResultPopupScrollOffset((offset: number) => clampNumber(offset - 1, 0, maxOffset));
        return;
      }
      if (isDownKey(event)) {
        event.preventDefault();
        setResultPopupScrollOffset((offset: number) => clampNumber(offset + 1, 0, maxOffset));
        return;
      }
      if (isPageUpKey(event)) {
        event.preventDefault();
        setResultPopupScrollOffset((offset: number) => clampNumber(offset - pageSize, 0, maxOffset));
        return;
      }
      if (isPageDownKey(event)) {
        event.preventDefault();
        setResultPopupScrollOffset((offset: number) => clampNumber(offset + pageSize, 0, maxOffset));
        return;
      }
      if (isHomeKey(event)) {
        event.preventDefault();
        setResultPopupScrollOffset(0);
        return;
      }
      if (isEndKey(event)) {
        event.preventDefault();
        setResultPopupScrollOffset(maxOffset);
        return;
      }
      event.preventDefault();
    }

  function handleHookKey(event: KeyEvent) {
    let { setHookValue, submitHookValue } = ctx();
      if (isDeletePreviousWordKey(event)) {
        event.preventDefault();
        setHookValue(deletePreviousWord);
        return;
      }
      if (event.name === "backspace") {
        event.preventDefault();
        setHookValue((value: any) => value.slice(0, -1));
        return;
      }
      if (isReturnKey(event)) {
        event.preventDefault();
        void submitHookValue();
        return;
      }
      if (!event.ctrl && !event.meta && event.sequence && event.sequence.length === 1) {
        event.preventDefault();
        setHookValue((value: any) => value + event.sequence);
      }
    }

  function installStore(next: WorkflowRunStore) {
    let { setSnapshot, setStore, store, unsubscribeStore } = ctx();
      unsubscribeStore();
      store().close();
      setStore(next);
      setSnapshot(next.snapshot());
      unsubscribeStore = next.subscribe(setSnapshot);
    }

  function installViewedRun(run: WorkflowAppRun) {
    let { installStore, props, unsubscribeRun } = ctx();
      unsubscribeRun?.();
      const runStore = createWorkflowRunStore({
        graph: props.app.graph(run.workflowId),
        input: run.input,
        batchMs: 0,
      });
      for (const event of run.events) runStore.push(event);
      runStore.flush();
      installStore(runStore);
      unsubscribeRun = props.runtime.subscribe(run.runId, (event: any) => {
        runStore.push(event);
      });
    }

  function installViewedRunSnapshot(run: WorkflowAppRunSnapshot) {
    let { installStore, props, unsubscribeRun } = ctx();
      unsubscribeRun?.();
      unsubscribeRun = undefined;
      const runStore = createWorkflowRunStore({
        graph: props.app.graph(run.workflowId),
        input: run.input,
        batchMs: 0,
      });
      for (const event of run.events) runStore.push(event);
      runStore.flush();
      installStore(runStore);
    }

  function viewRun(run: WorkflowAppRun, type: "artifact" | "run") {
    let { installViewedRun, isActiveWorkflowStatus, props, rememberRun, setError, setHookRun, setResult, setRoute, setSelectedSidebarTab, setSelectedWorkflowId, setStatus, setViewedRunOrigin, updateArtifactsForRun } = ctx();
      rememberRun(run);
      setSelectedWorkflowId(run.workflowId);
      installViewedRun(run);
      setViewedRunOrigin(run.origin);
      setStatus(shellStatus(run.status));
      const formatted = formatTuiRunResult(props.app, run);
      setResult(formatted.result);
      setError(formatted.error);
      setHookRun(run.session.pendingHooks?.length ? run : undefined);
      if (isActiveWorkflowStatus(run.status)) setSelectedSidebarTab("activity");
      setRoute({ type, runId: run.runId, workflowId: run.workflowId });
      updateArtifactsForRun(run);
    }

  return { handleRunKey, handleResultPopupKey, handleHookKey, installStore, installViewedRun, installViewedRunSnapshot, viewRun };
}
