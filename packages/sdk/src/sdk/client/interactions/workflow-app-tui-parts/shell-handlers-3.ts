import { deletePreviousWord, isDeletePreviousWordKey, isDownKey, isEscapeKey, isInterruptKey, isReturnKey, isUpKey } from "./routing-keyboard.js";
import { type KeyEvent } from "@opentui/core";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellHandlerContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellHandlers3(ctx: WorkflowAppTuiShellHandlerContext) {

  function handleInterruptKey(event: KeyEvent) {
    let { clearPromptDraft, closeSlashCommands, commandOpen, configValueEditor, copySelectedTextToClipboard, dialog, hookRun, hookValue, navigateBackFromRoute, prompt, promptAttachments, promptFileViewer, props, questionController, route, setCommandOpen, setCommandQuery, setConfigValueEditor, setDialog, setHookValue, setPromptFileViewer, setPromptFileViewerScrollOffset, setSelectedStartPane, slashOpen, updateWorkflowQuery, workflowQuery } = ctx();
      if (!isInterruptKey(event)) return false;
      event.preventDefault();
      event.stopPropagation();
      if (copySelectedTextToClipboard()) return true;
      if (promptFileViewer()) {
        setPromptFileViewer(undefined);
        setPromptFileViewerScrollOffset(0);
        return true;
      }
      if (configValueEditor()) {
        setConfigValueEditor(undefined);
        return true;
      }
      if (dialog()) {
        const current = dialog();
        setDialog(undefined);
        if (current?.confirmOnInterrupt) current.confirm?.();
        return true;
      }
      if (commandOpen()) {
        setCommandOpen(false);
        setCommandQuery("");
        return true;
      }
      if (slashOpen()) {
        closeSlashCommands();
        return true;
      }
      if (questionController.current()) {
        questionController.complete(false);
        return true;
      }
      if (hookRun()) {
        if (hookValue()) setHookValue("");
        return true;
      }
      const currentRoute = route();
      if (currentRoute.type === "library" && workflowQuery()) {
        updateWorkflowQuery("");
        return true;
      }
      if ((currentRoute.type === "start" || currentRoute.type === "triggerFire") && (prompt() || promptAttachments().length > 0)) {
        clearPromptDraft();
        if (currentRoute.type === "start") setSelectedStartPane("fields");
        return true;
      }
      if (
        currentRoute.type === "start" ||
        currentRoute.type === "run" ||
        currentRoute.type === "artifact" ||
        currentRoute.type === "step" ||
        currentRoute.type === "triggers" ||
        currentRoute.type === "triggerFire" ||
        currentRoute.type === "triggerJobs"
      ) {
        navigateBackFromRoute(currentRoute);
        return true;
      }
      props.onExit();
      return true;
    }

  function handleCommandKey(event: KeyEvent) {
    let { commandIndex, filteredCommands, setCommandIndex, setCommandOpen, setCommandQuery } = ctx();
      if (isEscapeKey(event)) {
        event.preventDefault();
        setCommandOpen(false);
        return;
      }
      if (isDeletePreviousWordKey(event)) {
        event.preventDefault();
        setCommandQuery(deletePreviousWord);
        setCommandIndex(0);
        return;
      }
      if (event.name === "backspace") {
        event.preventDefault();
        setCommandQuery((value: any) => value.slice(0, -1));
        setCommandIndex(0);
        return;
      }
      if (isUpKey(event)) {
        event.preventDefault();
        const count = filteredCommands().length;
        if (count > 0) setCommandIndex((value: any) => (value - 1 + count) % count);
        return;
      }
      if (isDownKey(event)) {
        event.preventDefault();
        const count = filteredCommands().length;
        if (count > 0) setCommandIndex((value: any) => (value + 1) % count);
        return;
      }
      if (isReturnKey(event)) {
        event.preventDefault();
        const item = filteredCommands()[commandIndex()];
        setCommandOpen(false);
        setCommandQuery("");
        item?.run();
        return;
      }
      if (!event.ctrl && !event.meta && event.sequence && event.sequence.length === 1) {
        event.preventDefault();
        setCommandQuery((value: any) => value + event.sequence);
        setCommandIndex(0);
      }
    }

  return { handleInterruptKey, handleCommandKey };
}
