import { type TriggerDescriptor } from "../../../workflow-control-plane/index.js";
import { defaultTriggerInputText, titleFromIdentifier } from "./input-form.js";
import { clampIndex } from "./routing-keyboard.js";
import { formatWorkspaceTestDuration, workspaceIssueValue, workspacePatchCount } from "./sidebar.js";
import { type ShellCommand, type TuiWorkspaceFrame } from "./types.js";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellHandlerContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellHandlers10(ctx: WorkflowAppTuiShellHandlerContext) {

  function recallPromptHistory(delta: -1 | 1) {
    let { prompt, promptHistory, promptHistoryCursor, promptHistoryDraft, replacePromptDraft, resetPromptHistoryBrowse, setPromptHistoryCursor, setPromptHistoryDraft } = ctx();
      if (promptHistory.length === 0) return;
      if (promptHistoryCursor === undefined) {
        if (delta > 0) return;
        const nextCursor = promptHistory.length - 1;
        setPromptHistoryDraft(prompt());
        setPromptHistoryCursor(nextCursor);
        replacePromptDraft(promptHistory[nextCursor] ?? "");
        return;
      }
      if (delta > 0 && promptHistoryCursor >= promptHistory.length - 1) {
        const draft = promptHistoryDraft;
        resetPromptHistoryBrowse();
        replacePromptDraft(draft);
        return;
      }
      const nextCursor = Math.max(0, Math.min(promptHistory.length - 1, promptHistoryCursor + delta));
      setPromptHistoryCursor(nextCursor);
      replacePromptDraft(promptHistory[nextCursor] ?? "");
    }

  function resetPromptHistoryBrowse() {
    let { setPromptHistoryCursor, setPromptHistoryDraft } = ctx();
      setPromptHistoryCursor(undefined);
      setPromptHistoryDraft("");
    }

  function updateWorkflowQuery(next: string) {
    let { selectWorkflow, selectedWorkflowId, setWorkflowQuery, workflows } = ctx();
      setWorkflowQuery(next);
      const query = next.trim().toLowerCase();
      const matches = query
        ? workflows().filter((workflow: any) =>
          workflow.id.toLowerCase().includes(query) ||
          workflow.title.toLowerCase().includes(query) ||
          workflow.description?.toLowerCase().includes(query)
        )
        : workflows();
      if (matches.length > 0 && !matches.some((workflow: any) => workflow.id === selectedWorkflowId())) {
        selectWorkflow(matches[0]!.id);
      }
    }

  async function refreshTriggerRuntime() {
    let { props, setSelectedJobIndex, setSelectedTriggerIndex, setTriggerJobs, setTriggers } = ctx();
      if (!props.controlPlane) return;
      const [nextTriggers, nextJobs] = await Promise.all([
        props.controlPlane.listTriggers(),
        props.controlPlane.listTriggerJobs(),
      ]);
      setTriggers(nextTriggers);
      setTriggerJobs(nextJobs);
      setSelectedTriggerIndex((index: number) => clampIndex(index, nextTriggers.length));
      setSelectedJobIndex((index: number) => clampIndex(index, nextJobs.length));
    }

  function selectTriggerIndex(index: number) {
    let { setRoute, setSelectedTriggerIndex, setSelectedWorkflowId, triggers } = ctx();
      const next = clampIndex(index, triggers().length);
      setSelectedTriggerIndex(next);
      const trigger = triggers()[next];
      if (trigger) {
        setSelectedWorkflowId(trigger.workflowId);
        setRoute({ triggerId: trigger.id, type: "triggers" });
      }
    }

  function selectJobIndex(index: number) {
    let { setRoute, setSelectedJobIndex, triggerJobs } = ctx();
      const next = clampIndex(index, triggerJobs().length);
      setSelectedJobIndex(next);
      const job = triggerJobs()[next];
      setRoute({ jobId: job?.id, type: "triggerJobs" });
    }

  async function navigateTriggers() {
    let { refreshTriggerRuntime, selectedTrigger, setRoute, setSelectedWorkflowId } = ctx();
      await refreshTriggerRuntime();
      const trigger = selectedTrigger();
      if (trigger) setSelectedWorkflowId(trigger.workflowId);
      setRoute({ triggerId: trigger?.id, type: "triggers" });
    }

  async function navigateTriggerJobs(jobId?: string) {
    let { refreshTriggerRuntime, selectedTriggerJob, setRoute, setSelectedJobIndex, triggerJobs } = ctx();
      await refreshTriggerRuntime();
      if (jobId) {
        const index = triggerJobs().findIndex((job: any) => job.id === jobId);
        if (index >= 0) setSelectedJobIndex(index);
      }
      setRoute({ jobId: jobId ?? selectedTriggerJob()?.id, type: "triggerJobs" });
    }

  function navigateTriggerFire(trigger: TriggerDescriptor) {
    let { replacePromptDraft, setRoute, setSelectedWorkflowId } = ctx();
      setSelectedWorkflowId(trigger.workflowId);
      replacePromptDraft(defaultTriggerInputText(trigger));
      setRoute({ triggerId: trigger.id, type: "triggerFire", workflowId: trigger.workflowId });
    }

  async function submitTriggerPrompt() {
    let { navigateTriggerJobs, prompt, props, replacePromptDraft, route, setDialog } = ctx();
      const currentRoute = route();
      if (!props.controlPlane || currentRoute.type !== "triggerFire") return;
      let parsedInput: unknown;
      try {
        parsedInput = prompt().trim() ? JSON.parse(prompt()) : {};
      } catch (error) {
        setDialog({
          message: error instanceof Error ? error.message : String(error),
          title: "Invalid JSON",
          variant: "error",
        });
        return;
      }
      const result = await props.controlPlane.enqueueTrigger({
        input: parsedInput,
        source: "tui",
        triggerId: currentRoute.triggerId,
        trusted: true,
      });
      replacePromptDraft("");
      await navigateTriggerJobs(result.job.id);
    }

  function selectedWorkspaceSource() {
    let { props, selectedWorkflowId } = ctx();
      return props.app.getWorkflow(selectedWorkflowId()).workspace;
    }

  function workspaceCommands(): ShellCommand[] {
  let { mutateSelectedWorkspace, publishSelectedWorkspaceDraft, selectedWorkspaceSource, testSelectedWorkspaceDraft } = ctx();
      const workspace = selectedWorkspaceSource();
      if (!workspace) return [];
      const frame = workspace.frame();
      const commands: ShellCommand[] = [];
      if (frame.proposal && typeof workspace.acceptProposal === "function") {
        commands.push({
          hint: "accept",
          title: "Accept Workflow Patch Proposal",
          value: "workflow.workspace.accept-proposal",
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
      if (frame.proposal && typeof workspace.rejectProposal === "function") {
        commands.push({
          hint: "reject",
          title: "Reject Workflow Patch Proposal",
          value: "workflow.workspace.reject-proposal",
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
      if (typeof workspace.publish === "function") {
        commands.push({
          hint: "publish",
          title: frame.status === "published" ? "Publish Workflow Draft Again" : "Publish Workflow Draft",
          value: "workflow.workspace.publish",
          run() {
            mutateSelectedWorkspace("Publish Workflow Draft", () => {
              return publishSelectedWorkspaceDraft();
            });
          },
        });
      }
      if (typeof workspace.test === "function") {
        commands.push({
          hint: "test",
          title: "Test Workflow Draft",
          value: "workflow.workspace.test",
          run() {
            void testSelectedWorkspaceDraft();
          },
        });
      }
      if (typeof workspace.undo === "function") {
        commands.push({
          hint: "undo",
          title: "Undo Last Workflow Patch",
          value: "workflow.workspace.undo",
          run() {
            mutateSelectedWorkspace("Undo Workflow Patch", () => {
              const workspace = selectedWorkspaceSource();
              if (!workspace?.undo) throw new Error("This workflow workspace cannot undo patches from the TUI.");
              return workspace.undo();
            });
          },
        });
      }
      if (typeof workspace.redo === "function") {
        commands.push({
          hint: "redo",
          title: "Redo Workflow Patch",
          value: "workflow.workspace.redo",
          run() {
            mutateSelectedWorkspace("Redo Workflow Patch", () => {
              const workspace = selectedWorkspaceSource();
              if (!workspace?.redo) throw new Error("This workflow workspace cannot redo patches from the TUI.");
              return workspace.redo();
            });
          },
        });
      }
      return commands;
    }

  function publishSelectedWorkspaceDraft() {
    let { registerPublishedWorkspaceWorkflow, selectedWorkspaceSource } = ctx();
      const workspace = selectedWorkspaceSource();
      if (!workspace?.publish) throw new Error("This workflow workspace cannot be published from the TUI.");
      const frame = workspace.publish({ version: new Date().toISOString() });
      registerPublishedWorkspaceWorkflow(frame);
      return frame;
    }

  async function testSelectedWorkspaceDraft() {
    let { selectedWorkspaceSource, setDialog, setWorkspaceRevision, showToast, workspaceTestPromptInput } = ctx();
      const workspace = selectedWorkspaceSource();
      if (!workspace?.test) {
        setDialog({
          message: "This workflow workspace cannot be tested from the TUI.",
          title: "Test Workflow Draft",
          variant: "help",
        });
        return;
      }
      showToast({
        message: "Running the current draft with the prompt text.",
        title: "Test Workflow Draft",
        variant: "info",
      });
      try {
        const testResult = await workspace.test({
          input: workspaceTestPromptInput(),
        });
        setWorkspaceRevision((revision: number) => revision + 1);
        showToast({
          message: `${testResult.status} · ${formatWorkspaceTestDuration(testResult.durationMs)}`,
          title: "Test Workflow Draft",
          variant: testResult.status === "failed" ? "error" : "info",
        });
        if (testResult.status === "failed") {
          setDialog({
            message: testResult.error ?? "The workflow draft test failed.",
            title: "Test Workflow Draft",
            variant: "error",
          });
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setDialog({
          message,
          title: "Test Workflow Draft",
          variant: "error",
        });
      }
    }

  function registerPublishedWorkspaceWorkflow(frame: TuiWorkspaceFrame) {
    let { navigateStart, props, selectedWorkspaceSource, setWorkflowRevision } = ctx();
      const workspace = selectedWorkspaceSource();
      const document = frame.parsedDocument;
      if (!document || !frame.validation.ok || !workspace?.compile || !props.app.registerWorkflow) return;
      const workflow = workspace.compile();
      if (!workflow) return;
      const workflowId = document.id;
      props.app.registerWorkflow(workflowId, {
        description: document.description,
        input: {
          kind: "prompt",
          placeholder: document.trigger.label ? `Input for ${document.trigger.label}` : "Workflow input",
        },
        title: document.label ?? titleFromIdentifier(workflowId),
        workflow,
        workspace,
      });
      setWorkflowRevision((revision: number) => revision + 1);
      navigateStart(workflowId);
    }

  function mutateSelectedWorkspace(
      title: string,
      mutate: () => TuiWorkspaceFrame,
    ) {
  let { setDialog, setWorkspaceRevision, showToast } = ctx();
      try {
        const frame = mutate();
        setWorkspaceRevision((revision: number) => revision + 1);
        showToast({
          message: `${frame.status} · ${workspacePatchCount(frame)} · ${workspaceIssueValue(frame)} issues`,
          title,
          variant: frame.validation.ok ? "info" : "error",
        });
      } catch (caught) {
        setDialog({
          message: caught instanceof Error ? caught.message : String(caught),
          title,
          variant: "error",
        });
      }
    }

  return { recallPromptHistory, resetPromptHistoryBrowse, updateWorkflowQuery, refreshTriggerRuntime, selectTriggerIndex, selectJobIndex, navigateTriggers, navigateTriggerJobs, navigateTriggerFire, submitTriggerPrompt, selectedWorkspaceSource, workspaceCommands, publishSelectedWorkspaceDraft, testSelectedWorkspaceDraft, registerPublishedWorkspaceWorkflow, mutateSelectedWorkspace };
}
