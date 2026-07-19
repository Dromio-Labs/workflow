import { workflowConfigurationEditPrompt } from "./config-utils.js";
import { type ShellCommand } from "./types.js";
import * as path from "node:path";
import { createMemo, Show, Switch } from "solid-js";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellCommandContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellCommands(ctx: WorkflowAppTuiShellCommandContext) {
  return createMemo<ShellCommand[]>(() => {
    const { keymap, libraryViewMode, navigateLibrary, navigateStart, openResultPopup, openSelectedExternalEditorTarget, openWorkflowSessions, pasteClipboardImage, prompt, props, replacePromptDraft, route, selectedExternalEditorTarget, selectedWorkflow, selectedWorkflowId, setDialog, setWorkflowRoomVisible, setWorkflowViewProtocolMode, stepModelSelectionCommands, toggleLibraryView, triggerCommands, viewRun, viewedRun, workflowRoomVisible, workspaceCommands } = ctx();
    return [
      {
        hint: "library",
        title: "Open Workflow Library",
        value: "workflow.library",
        run() {
          navigateLibrary();
        },
      },
      {
        hint: "view",
        title: `Switch Library To ${libraryViewMode() === "apps" ? "Workflow" : "App"} View`,
        value: "workflow.library.view",
        run() {
          toggleLibraryView();
        },
      },
      {
        hint: "start",
        title: `Start ${selectedWorkflow().title}`,
        value: "workflow.start",
        run() {
          navigateStart(selectedWorkflowId());
        },
      },
      {
        hint: "paste",
        title: "Paste Clipboard Attachment",
        value: "prompt.paste",
        run() {
          if (route().type !== "start") navigateStart(selectedWorkflowId());
          void pasteClipboardImage().then((pasted: any) => {
            if (pasted) return;
            setDialog({
              message: "No image was found on the clipboard. You can also paste an image file path into the prompt.",
              title: "Clipboard",
              variant: "help",
            });
          });
        },
      },
      {
        hint: "config",
        title: `Edit ${selectedWorkflow().title} Configuration`,
        value: "workflow.config.edit",
        run() {
          const next = workflowConfigurationEditPrompt(selectedWorkflow(), prompt());
          if (!next) {
            setDialog({
              message: "This workflow does not expose editable configuration.",
              title: "Workflow Configuration",
              variant: "help",
            });
            return;
          }
          navigateStart(selectedWorkflowId());
          replacePromptDraft(next);
        },
      },
      {
        hint: keymap.openEditor,
        title: selectedExternalEditorTarget()?.title ?? `Open ${selectedWorkflow().title} Config in External Editor`,
        value: "workflow.editor.open",
        run() {
          void openSelectedExternalEditorTarget();
        },
      },
      {
        hint: "run",
        title: "Inspect Current Run",
        value: "workflow.run",
        run() {
          const run = viewedRun();
          if (!run) return;
          viewRun(run, "run");
        },
      },
      {
        hint: "session",
        title: `Open ${selectedWorkflow().title} Sessions`,
        value: "workflow.sessions",
        run() {
          openWorkflowSessions();
        },
      },
      ...workspaceCommands(),
      ...triggerCommands(),
      ...stepModelSelectionCommands(),
      {
        hint: keymap.contextPanelToggle,
        title: `${workflowRoomVisible() ? "Hide" : "Show"} Workflow Room`,
        value: "workflow.room.toggle",
        run() {
          setWorkflowRoomVisible((visible: boolean) => !visible);
        },
      },
      {
        hint: "render",
        title: "Show Workflow Room Render",
        value: "workflow.room.render",
        run() {
          setWorkflowRoomVisible(true);
          setWorkflowViewProtocolMode("render");
        },
      },
      {
        hint: "json",
        title: "Show Workflow Room Component JSON",
        value: "workflow.room.json",
        run() {
          setWorkflowRoomVisible(true);
          setWorkflowViewProtocolMode("json");
        },
      },
      {
        hint: "schema",
        title: "Show Workflow Room Schema",
        value: "workflow.room.schema",
        run() {
          setWorkflowRoomVisible(true);
          setWorkflowViewProtocolMode("schema");
        },
      },
      {
        hint: "artifact",
        title: "Open Result Artifact",
        value: "workflow.artifact",
        run() {
          openResultPopup(undefined);
        },
      },
      {
        hint: "?",
        title: "Show Workflow Help",
        value: "workflow.help",
        run() {
          setDialog({
            message: "Use the library to choose a workflow, enter to start, arrow keys to answer questions, r to rerun, and ctrl+p for commands.",
            title: "Workflow Help",
            variant: "help",
          });
        },
      },
      {
        hint: "stop",
        title: "Interrupt Workflow Shell",
        value: "workflow.interrupt",
        run() {
          setDialog({
            confirm: props.onExit,
            message: "Stop the current TUI session and return control to the host?",
            title: "Interrupt Workflow",
            variant: "confirm",
          });
        },
      },
    ];
  });
}
