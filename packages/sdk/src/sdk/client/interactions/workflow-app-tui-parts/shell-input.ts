import { isPasteKey, isSlashCommandKey, keyMatches } from "./routing-keyboard.js";
import { useKeyboard, usePaste } from "@opentui/solid";
import { release } from "node:os";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellInputContext = WorkflowAppTuiShellContext;

export function installWorkflowAppTuiShellInput(ctx: WorkflowAppTuiShellInputContext) {
  let { commandKey, commandOpen, configValueEditor, dialog, handleCommandKey, handleConfigValueEditorKey, handleConfigValueEditorPaste, handleDialogKey, handleHookKey, handleInterruptKey, handleLibraryDiagramKey, handleLibraryKey, handleMetadataPopupKey, handlePasteEvent, handlePromptFileViewerKey, handleResultPopupKey, handleRunKey, handleSessionListDialogKey, handleSlashCommandKey, handleStartKey, handleStepInspectorPopupKey, handleTriggerFireKey, handleTriggerJobsKey, handleTriggersKey, handleWorkflowExportWizardKey, handleWorkflowExportWizardPaste, hookRun, keymap, leaderActive, libraryDiagramOpen, metadataPopupOpen, openSelectedExternalEditorTarget, openSlashCommands, pasteClipboardImage, promptFileViewer, props, questionController, resultPopup, route, sessionListDialog, setCommandIndex, setCommandOpen, setCommandQuery, setLeaderActive, setLeaderForKey, setLibraryDiagramOpen, setSlashOpen, setSlashQuery, setWorkflowRoomVisible, slashOpen, stepInspectorPopup, triggerJobs, triggers, workflowExportWizard } = ctx();
  useKeyboard((event) => {
      if (event.eventType === "release") return;
      if (handleInterruptKey(event)) return;
      if (promptFileViewer()) {
        handlePromptFileViewerKey(event);
        return;
      }
      if (resultPopup()) {
        handleResultPopupKey(event);
        return;
      }
      if (stepInspectorPopup()) {
        handleStepInspectorPopupKey(event);
        return;
      }
      if (configValueEditor()) {
        handleConfigValueEditorKey(event);
        return;
      }
      if (sessionListDialog()) {
        handleSessionListDialogKey(event);
        return;
      }
      if (metadataPopupOpen()) {
        handleMetadataPopupKey(event);
        return;
      }
      if (workflowExportWizard()) {
        handleWorkflowExportWizardKey(event);
        return;
      }
      const leaderForKey = ctx().leaderForKey || leaderActive();
      if (!leaderForKey && keyMatches(event, keymap.leader)) {
        event.preventDefault();
        setLeaderForKey(true);
        setLeaderActive(true);
        return;
      }
      if (leaderForKey) {
        queueMicrotask(() => {
          setLeaderForKey(false);
          setLeaderActive(false);
        });
      }
      if (dialog()) {
        handleDialogKey(event);
        return;
      }
      if (commandKey(event, keymap.commandPalette)) {
        event.preventDefault();
        setLibraryDiagramOpen(false);
        setSlashOpen(false);
        setSlashQuery("");
        setCommandOpen((value: any) => {
          const next = !value;
          if (next) {
            setCommandIndex(0);
            setCommandQuery("");
          }
          return next;
        });
        return;
      }
      if (commandKey(event, keymap.contextPanelToggle) && route().type === "run") {
        event.preventDefault();
        event.stopPropagation();
        setWorkflowRoomVisible((visible: boolean) => !visible);
        return;
      }
      if (commandKey(event, keymap.openEditor)) {
        event.preventDefault();
        event.stopPropagation();
        void openSelectedExternalEditorTarget();
        return;
      }
      if (commandOpen()) {
        handleCommandKey(event);
        return;
      }
      if (slashOpen()) {
        handleSlashCommandKey(event);
        return;
      }
      if (libraryDiagramOpen()) {
        handleLibraryDiagramKey(event);
        return;
      }
      if (event.ctrl && event.name === "d") {
        event.preventDefault();
        props.onExit();
        return;
      }
      if (isSlashCommandKey(event)) {
        event.preventDefault();
        openSlashCommands();
        return;
      }
      if (questionController.current()) return;
      if (isPasteKey(event) && route().type === "start") {
        void pasteClipboardImage().then((pasted: any) => {
          if (pasted) event.preventDefault();
        });
        return;
      }
      if (hookRun()) {
        handleHookKey(event);
        return;
      }
      const currentRoute = route();
      if (currentRoute.type === "library") {
        handleLibraryKey(event);
        return;
      }
      if (currentRoute.type === "start") {
        handleStartKey(event);
        return;
      }
      if (currentRoute.type === "triggers") {
        handleTriggersKey(event);
        return;
      }
      if (currentRoute.type === "triggerFire") {
        handleTriggerFireKey(event);
        return;
      }
      if (currentRoute.type === "triggerJobs") {
        handleTriggerJobsKey(event);
        return;
      }
      if (currentRoute.type === "run" || currentRoute.type === "artifact" || currentRoute.type === "step") {
        handleRunKey(event);
      }
    });
  usePaste((event) => {
      if (configValueEditor()) {
        event.preventDefault();
        handleConfigValueEditorPaste(event);
        return;
      }
      if (workflowExportWizard()) {
        event.preventDefault();
        handleWorkflowExportWizardPaste(event);
        return;
      }
      if (dialog() || commandOpen() || slashOpen() || questionController.current()) return;
      if (route().type !== "start") return;
      event.preventDefault();
      void handlePasteEvent(event);
    });
}
