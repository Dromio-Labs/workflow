import { workflowConfigurationEditPrompt } from "./config-utils.js";
import { deletePreviousWord, isCtrlNavigationKey, isDeletePreviousWordKey, isDownKey, isEscapeKey, isReturnKey, isUpKey } from "./routing-keyboard.js";
import { type SlashCommand } from "./types.js";
import { slashCommandInputForRun, workflowDescriptor } from "./workflow-design.js";
import { type KeyEvent } from "@opentui/core";
import { render } from "@opentui/solid";
import * as path from "node:path";
import { Show, Switch } from "solid-js";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellHandlerContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellHandlers4(ctx: WorkflowAppTuiShellHandlerContext) {

  function buildWorkflowShellSlashCommands(): SlashCommand[] {
    let { libraryViewMode, mutateSelectedWorkspace, navigateLibrary, navigateStart, navigateTriggerJobs, navigateTriggers, openResultPopup, openWorkflowConfigExternalEditor, openWorkflowExportMode, openWorkflowSessions, pasteClipboardImage, prompt, props, publishSelectedWorkspaceDraft, replacePromptDraft, route, selectedStartInputMode, selectedWorkflow, selectedWorkflowId, selectedWorkspaceSource, setCommandIndex, setCommandOpen, setCommandQuery, setDialog, setStartInputMode, showHelpDialog, startInputForm, stepModelSelectionCommands, submitPrompt, submitTriggerPrompt, testSelectedWorkspaceDraft, toggleLibraryView, viewRun, viewedRun, workflows } = ctx();
      const currentRoute = route();
      const items: SlashCommand[] = [];
      if (
        startInputForm() &&
        (currentRoute.type === "start" || currentRoute.type === "triggerFire")
      ) {
        items.push({
          description: selectedStartInputMode() === "render"
            ? "Already using rendered input fields"
            : "Switch to rendered input fields",
          name: "/render",
          run() {
            setStartInputMode("render");
          },
        });
        items.push({
          description: selectedStartInputMode() === "raw"
            ? "Already using raw JSON/text input"
            : "Switch to raw JSON/text input",
          name: "/raw",
          run() {
            setStartInputMode("raw");
          },
        });
      }
      items.push(
        {
          description: "Open Workflow Library",
          name: "/library",
          run() {
            navigateLibrary();
          },
        },
        {
          description: `Switch library to ${libraryViewMode() === "apps" ? "workflow" : "app"} view`,
          name: "/view",
          run() {
            toggleLibraryView();
          },
        },
        {
          description: props.exportWorkflows ? "Select workflows to export as an app bundle" : "Export handler is not configured",
          name: "/export",
          run() {
            openWorkflowExportMode();
          },
        },
        {
          description: `Start ${selectedWorkflow().title}`,
          name: "/start",
          run() {
            navigateStart(selectedWorkflowId());
          },
        },
      );
      items.push({
        description: "Find previous runs for the current workflow",
        name: "/session",
        run() {
          openWorkflowSessions();
        },
      });
      if (currentRoute.type === "start") {
        items.push({
          description: `Run ${selectedWorkflow().title}`,
          name: "/run",
          run() {
            void submitPrompt();
          },
        });
      }
      if (currentRoute.type === "triggerFire") {
        items.push({
          description: "Enqueue the selected trigger",
          name: "/run",
          run() {
            void submitTriggerPrompt();
          },
        });
      }
      items.push({
        description: "Paste image or file from clipboard",
        name: "/paste",
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
      });
      if (viewedRun()) {
        items.push(
          {
            description: "Inspect the current workflow run",
            name: "/inspect",
            run() {
              const run = viewedRun();
              if (run) viewRun(run, "run");
            },
          },
          {
            description: "Open the current result artifact",
            name: "/artifact",
            run() {
              openResultPopup(undefined);
            },
          },
        );
      }
      if ((selectedWorkflow().configuration?.fields.length ?? 0) > 0) {
        items.push({
          description: `Edit ${selectedWorkflow().title} configuration`,
          name: "/config",
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
        });
        items.push({
          description: "Open the workflow config file in your external editor",
          name: "/config-editor",
          run() {
            void openWorkflowConfigExternalEditor();
          },
        });
      }
      const workspace = selectedWorkspaceSource();
      const frame = workspace?.frame();
      if (frame?.proposal && workspace?.acceptProposal) {
        items.push({
          description: "Accept the current workflow patch proposal",
          name: "/accept",
          run() {
            mutateSelectedWorkspace("Accept Workflow Patch Proposal", () => {
              const workspace = selectedWorkspaceSource();
              if (!workspace?.acceptProposal) {
                throw new Error("This workflow workspace cannot accept patch proposals from the TUI.");
              }
              return workspace.acceptProposal();
            });
          },
        });
      }
      if (frame?.proposal && workspace?.rejectProposal) {
        items.push({
          description: "Reject the current workflow patch proposal",
          name: "/reject",
          run() {
            mutateSelectedWorkspace("Reject Workflow Patch Proposal", () => {
              const workspace = selectedWorkspaceSource();
              if (!workspace?.rejectProposal) {
                throw new Error("This workflow workspace cannot reject patch proposals from the TUI.");
              }
              return workspace.rejectProposal();
            });
          },
        });
      }
      if (workspace?.publish) {
        items.push({
          description: "Solidify the current valid workflow draft",
          name: "/publish",
          run() {
            mutateSelectedWorkspace("Publish Workflow Draft", () => {
              return publishSelectedWorkspaceDraft();
            });
          },
        });
      }
      if (workspace?.test) {
        items.push({
          description: "Run the current valid workflow draft with the prompt text",
          name: "/test",
          run() {
            void testSelectedWorkspaceDraft();
          },
        });
      }
      if (workspace?.undo) {
        items.push({
          description: "Undo the latest workflow workspace patch",
          name: "/undo",
          run() {
            mutateSelectedWorkspace("Undo Workflow Patch", () => {
              const workspace = selectedWorkspaceSource();
              if (!workspace?.undo) throw new Error("This workflow workspace cannot undo patches from the TUI.");
              return workspace.undo();
            });
          },
        });
      }
      if (workspace?.redo) {
        items.push({
          description: "Redo the next workflow workspace patch",
          name: "/redo",
          run() {
            mutateSelectedWorkspace("Redo Workflow Patch", () => {
              const workspace = selectedWorkspaceSource();
              if (!workspace?.redo) throw new Error("This workflow workspace cannot redo patches from the TUI.");
              return workspace.redo();
            });
          },
        });
      }
      if (props.controlPlane) {
        items.push(
          {
            description: "Open Trigger Registry",
            name: "/triggers",
            run() {
              void navigateTriggers();
            },
          },
          {
            description: "Open Trigger Jobs",
            name: "/jobs",
            run() {
              void navigateTriggerJobs();
            },
          },
        );
      }
      if (stepModelSelectionCommands().length > 0) {
        items.push({
          description: "Choose model worker for the active step",
          name: "/step-model",
          run() {
            setCommandOpen(true);
            setCommandIndex(0);
            setCommandQuery("step-model");
          },
        });
      }
      for (const command of props.app.listCommands()) {
        const usage = command.usage ?? `/${command.name}`;
        items.push({
          description: command.description ?? `Route input to ${workflowDescriptor(workflows(), command.workflowId).title}`,
          name: `/${command.name}`,
          run() {
            navigateStart(command.workflowId);
            replacePromptDraft(`${usage.split(/\s+/)[0] ?? `/${command.name}`} `);
          },
        });
      }
      items.push(
        {
          description: "Show workflow help",
          name: "/help",
          run() {
            showHelpDialog(
              "Workflow Help",
              "Use the library to choose a workflow, enter to start, arrow keys to answer questions, r to rerun, and ctrl+p for commands.",
            );
          },
        },
        {
          description: "Interrupt Workflow Shell",
          name: "/stop",
          run() {
            setDialog({
              confirm: props.onExit,
              message: "Stop the current TUI session and return control to the host?",
              title: "Interrupt Workflow",
              variant: "confirm",
            });
          },
        },
      );
      return items;
    }

  function openSlashCommands() {
    let { setSlashIndex, setSlashOpen, setSlashQuery } = ctx();
      setSlashOpen(true);
      setSlashIndex(0);
      setSlashQuery("");
    }

  function toggleLibraryView() {
    let { navigateLibrary, setLibraryViewMode } = ctx();
      setLibraryViewMode((mode: any) => mode === "apps" ? "workflows" : "apps");
      navigateLibrary();
    }

  function closeSlashCommands() {
    let { setSlashIndex, setSlashOpen, setSlashQuery } = ctx();
      setSlashOpen(false);
      setSlashIndex(0);
      setSlashQuery("");
    }

  function handleSlashCommandKey(event: KeyEvent) {
    let { closeSlashCommands, filteredSlashCommands, setSlashIndex, setSlashQuery, slashIndex, slashQuery } = ctx();
      if (isEscapeKey(event)) {
        event.preventDefault();
        closeSlashCommands();
        return;
      }
      if (isDeletePreviousWordKey(event)) {
        event.preventDefault();
        setSlashQuery(deletePreviousWord);
        setSlashIndex(0);
        return;
      }
      if (event.name === "backspace") {
        event.preventDefault();
        if (!slashQuery()) {
          closeSlashCommands();
          return;
        }
        setSlashQuery((value: any) => value.slice(0, -1));
        setSlashIndex(0);
        return;
      }
      if (isUpKey(event) || isCtrlNavigationKey(event, "p")) {
        event.preventDefault();
        const count = filteredSlashCommands().length;
        if (count > 0) setSlashIndex((value: any) => (value - 1 + count) % count);
        return;
      }
      if (isDownKey(event) || isCtrlNavigationKey(event, "n") || event.name === "tab") {
        event.preventDefault();
        const count = filteredSlashCommands().length;
        if (count > 0) setSlashIndex((value: any) => (value + 1) % count);
        return;
      }
      if (isReturnKey(event)) {
        event.preventDefault();
        const item = filteredSlashCommands()[slashIndex()];
        item?.run();
        closeSlashCommands();
        return;
      }
      if (!event.ctrl && !event.meta && event.sequence && event.sequence.length === 1) {
        event.preventDefault();
        setSlashQuery((value: any) => value + event.sequence.replace(/^\//, ""));
        setSlashIndex(0);
      }
    }

  return { buildWorkflowShellSlashCommands, openSlashCommands, toggleLibraryView, closeSlashCommands, handleSlashCommandKey };
}
