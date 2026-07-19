import { resolveWorkflowAppStartInput } from "../workflow-app.js";
import { createWorkflowRunStore } from "../workflow-run-store.js";
import { promptInputWithAttachments } from "./attachments.js";
import type { WorkflowAppTuiShellContext } from "./shell-context.js";
import type { ShellRoute } from "./types.js";
import { firstDesignNodeId } from "./workflow-design.js";
import { rmSync } from "node:fs";

export type WorkflowAppTuiShellHandlerContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellHandlers12(ctx: WorkflowAppTuiShellHandlerContext) {
  function navigateBackFromRouteTarget(currentRoute: ShellRoute) {
    const { navigateLibrary, navigateStart, navigateTriggers, runById, viewRun, viewedRun } = ctx();
    if (currentRoute.type === "start") {
      navigateLibrary();
      return;
    }
    if (currentRoute.type === "triggers" || currentRoute.type === "triggerJobs") {
      navigateLibrary();
      return;
    }
    if (currentRoute.type === "triggerFire") {
      void navigateTriggers();
      return;
    }
    if (currentRoute.type === "artifact") {
      const run = currentRoute.runId
        ? runById(currentRoute.runId) ?? viewedRun()
        : viewedRun();
      if (run) {
        viewRun(run, "run");
        return;
      }
      navigateLibrary();
      return;
    }
    if (currentRoute.type === "step") {
      const run = currentRoute.runId ? runById(currentRoute.runId) ?? viewedRun() : undefined;
      if (run) {
        viewRun(run, "run");
        return;
      }
      navigateStart(currentRoute.workflowId);
      return;
    }
    navigateLibrary();
  }

  function activeWorkflowBlocksLibraryNavigation() {
    const { isActiveWorkflowStatus, status, viewedRun } = ctx();
    return isActiveWorkflowStatus(status()) || isActiveWorkflowStatus(viewedRun()?.status);
  }

  function isActiveWorkflowStatus(value: string | undefined) {
    return value === "running" || value === "waiting";
  }

  function showWorkflowLibraryBlockedToast() {
    ctx().showToast({
      message: "Finish or terminate the current workflow before opening the Workflow Library.",
      title: "Workflow running",
      variant: "warning",
    });
  }

  function clearPromptDraft() {
    const { promptAttachments, replacePromptDraft, resetPromptHistoryBrowse, setPromptAttachments } = ctx();
    for (const attachment of promptAttachments()) {
      if (attachment.path) rmSync(attachment.path, { force: true });
    }
    resetPromptHistoryBrowse();
    replacePromptDraft("");
    setPromptAttachments([]);
  }

  async function submitPrompt() {
    const {
      continueRun, installStore, promptAttachments, promptTextForStartSubmission, props,
      rememberPromptHistory, rememberRun, replacePromptDraft, selectedWorkflowId, setArtifacts,
      setDialog, setError, setHookRun, setHookValue, setPromptAttachments, setResult, setRoute,
      setSelectedInputFieldIndex, setSelectedSidebarTab, setSelectedStartPane,
      setSelectedStartStepId, setSelectedWorkflowId, setStatus, showToast,
      startInputValidation, status,
    } = ctx();
    const attachments = promptAttachments();
    const validation = startInputValidation();
    if (validation) {
      setError(validation.message);
      setSelectedStartPane("fields");
      setSelectedInputFieldIndex(validation.fieldIndex);
      showToast({ message: validation.message, title: "Input required", variant: "warning" });
      return;
    }
    const promptText = promptTextForStartSubmission();
    const submittedInput = promptInputWithAttachments(promptText, attachments);
    if (!submittedInput || status() === "running" || status() === "waiting") return;
    rememberPromptHistory(promptText);
    const resolved = resolveWorkflowAppStartInput(props.app, {
      input: submittedInput,
      workflowId: selectedWorkflowId(),
    });
    const { input, workflowId } = resolved;
    setSelectedWorkflowId(workflowId);
    setSelectedStartStepId(firstDesignNodeId(props.app, workflowId));
    replacePromptDraft("");
    setHookRun(undefined);
    setHookValue("");
    setResult("");
    setError("");
    setArtifacts([]);
    setStatus("running");
    setSelectedSidebarTab("activity");
    const runStore = createWorkflowRunStore({ graph: props.app.graph(workflowId), input });
    installStore(runStore);
    setRoute({ type: "run", workflowId });
    try {
      const run = await props.runtime.startRun({
        attachments,
        input,
        onEvent(event) {
          runStore.push(event);
        },
        workflowId,
      });
      setPromptAttachments([]);
      rememberRun(run);
      runStore.flush();
      await continueRun(run, workflowId, runStore);
    } catch (caught) {
      setStatus("failed");
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setDialog({ message, title: "Run failed", variant: "error" });
    }
  }

  return {
    activeWorkflowBlocksLibraryNavigation,
    clearPromptDraft,
    isActiveWorkflowStatus,
    navigateBackFromRouteTarget,
    showWorkflowLibraryBlockedToast,
    submitPrompt,
  };
}
