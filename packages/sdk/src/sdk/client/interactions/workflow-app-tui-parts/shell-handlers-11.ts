import { type TriggerJobSnapshot } from "../../../workflow-control-plane/index.js";
import { workflowTuiOpenApiUrl, workflowTuiSwaggerUrl, workflowTuiTriggerCurl } from "../workflow-app-tui.js";
import { modelWorkerOptionLabel } from "./active-run-session.js";
import { defaultTriggerInputText } from "./input-form.js";
import { copyTextToClipboard, openExternalUrl } from "./native-io.js";
import { shellStatus } from "./runtime-utils.js";
import { type ShellCommand, type ShellRoute } from "./types.js";
import { firstDesignNodeId } from "./workflow-design.js";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellHandlerContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellHandlers11(ctx: WorkflowAppTuiShellHandlerContext) {

  function triggerCommands(): ShellCommand[] {
  let { confirmSelectedJobCancel, confirmSelectedJobDeadLetter, copyOpenApiUrl, copySelectedJobId, copySelectedTriggerCurl, keymap, navigateTriggerFire, navigateTriggerJobs, navigateTriggers, openSelectedJobRun, openSwaggerUi, props, retrySelectedJob, selectedTrigger, selectedTriggerJob } = ctx();
      if (!props.controlPlane) return [];
      const trigger = selectedTrigger();
      const job = selectedTriggerJob();
      return [
        {
          hint: keymap.triggers,
          title: "Open Trigger Registry",
          value: "triggers.open",
          run() {
            void navigateTriggers();
          },
        },
        {
          hint: keymap.jobs,
          title: "Open Trigger Jobs",
          value: "trigger-jobs.open",
          run() {
            void navigateTriggerJobs();
          },
        },
        {
          hint: keymap.fireTrigger,
          title: trigger ? `Fire ${trigger.label}` : "Fire Trigger",
          value: "triggers.fire",
          run() {
            const trigger = selectedTrigger();
            if (trigger) navigateTriggerFire(trigger);
          },
        },
        {
          hint: keymap.copyCurl,
          title: trigger ? `Copy curl for ${trigger.label}` : "Copy Trigger curl",
          value: "triggers.copy-curl",
          run() {
            void copySelectedTriggerCurl();
          },
        },
        {
          hint: keymap.openApi,
          title: "Copy OpenAPI URL",
          value: "triggers.openapi.copy-url",
          run() {
            void copyOpenApiUrl();
          },
        },
        {
          hint: keymap.openSwagger,
          title: "Open Swagger UI",
          value: "triggers.swagger.open",
          run() {
            void openSwaggerUi();
          },
        },
        {
          hint: keymap.copyId,
          title: job ? "Copy Selected Job ID" : "Copy Job ID",
          value: "trigger-jobs.copy-id",
          run() {
            void copySelectedJobId();
          },
        },
        {
          hint: keymap.viewRun,
          title: job?.runId ? "Open Linked Run" : "Open Linked Run",
          value: "trigger-jobs.open-run",
          run() {
            void openSelectedJobRun();
          },
        },
        {
          hint: keymap.retryJob,
          title: job ? "Retry Selected Job" : "Retry Job",
          value: "trigger-jobs.retry",
          run() {
            void retrySelectedJob();
          },
        },
        {
          hint: keymap.cancelJob,
          title: job ? "Cancel Selected Job" : "Cancel Job",
          value: "trigger-jobs.cancel",
          run() {
            confirmSelectedJobCancel();
          },
        },
        {
          hint: keymap.deadLetterJob,
          title: job ? "Dead-letter Selected Job" : "Dead-letter Job",
          value: "trigger-jobs.dead-letter",
          run() {
            confirmSelectedJobDeadLetter();
          },
        },
      ];
    }

  async function copySelectedTriggerCurl() {
    let { renderer, selectedTrigger, showHelpDialog } = ctx();
      const trigger = selectedTrigger();
      if (!trigger) {
        showHelpDialog("Trigger curl", "Select a trigger first.");
        return;
      }
      await copyTextToClipboard(workflowTuiTriggerCurl({
        inputJson: defaultTriggerInputText(trigger),
        trigger,
      }), renderer);
      showHelpDialog("Trigger curl", `Copied curl command for ${trigger.id}.`);
    }

  async function copyOpenApiUrl() {
    let { renderer, showHelpDialog } = ctx();
      await copyTextToClipboard(workflowTuiOpenApiUrl(), renderer);
      showHelpDialog("OpenAPI", `Copied ${workflowTuiOpenApiUrl()}.`);
    }

  async function openSwaggerUi() {
    let { renderer, showHelpDialog } = ctx();
      const url = workflowTuiSwaggerUrl();
      const opened = await openExternalUrl(url);
      if (opened) {
        showHelpDialog("Swagger", `Opened ${url}.`);
        return;
      }
      await copyTextToClipboard(url, renderer);
      showHelpDialog("Swagger", `Could not open a browser here, so copied ${url}.`);
    }

  async function copySelectedJobId() {
    let { renderer, selectedTriggerJob, showHelpDialog } = ctx();
      const job = selectedTriggerJob();
      if (!job) {
        showHelpDialog("Trigger job", "Select a job first.");
        return;
      }
      await copyTextToClipboard(job.id, renderer);
      showHelpDialog("Trigger job", `Copied ${job.id}.`);
    }

  async function openSelectedJobRun() {
    let { props, selectedTriggerJob, showErrorDialog, showHelpDialog, viewRunSnapshot } = ctx();
      if (!props.controlPlane) return;
      const job = selectedTriggerJob();
      if (!job?.runId) {
        showHelpDialog("Linked run", "This job has not started a workflow run yet.");
        return;
      }
      try {
        const run = await props.controlPlane.getRun(job.runId);
        viewRunSnapshot(run);
      } catch (caught) {
        showErrorDialog("Linked run", caught);
      }
    }

  async function retrySelectedJob() {
    let { navigateTriggerJobs, props, refreshTriggerRuntime, selectedTriggerJob, showErrorDialog, showHelpDialog } = ctx();
      if (!props.controlPlane) return;
      const job = selectedTriggerJob();
      if (!job) {
        showHelpDialog("Retry job", "Select a job first.");
        return;
      }
      try {
        const updated = await props.controlPlane.retryTriggerJob({ jobId: job.id });
        await refreshTriggerRuntime();
        await navigateTriggerJobs(updated.id);
        showHelpDialog("Retry job", `Queued retry for ${updated.id}.`);
      } catch (caught) {
        showErrorDialog("Retry job", caught);
      }
    }

  function confirmSelectedJobCancel() {
    let { props, runJobOperation, selectedTriggerJob, setDialog, showHelpDialog } = ctx();
      const job = selectedTriggerJob();
      if (!job) {
        showHelpDialog("Cancel job", "Select a job first.");
        return;
      }
      setDialog({
        confirm() {
          void runJobOperation("Cancel job", () => props.controlPlane!.cancelTriggerJob({
            jobId: job.id,
            reason: "Cancelled from TUI",
          }));
        },
        message: `Cancel ${job.id}? This moves it to the dead-letter queue with an operator reason.`,
        title: "Cancel job",
        variant: "confirm",
      });
    }

  function confirmSelectedJobDeadLetter() {
    let { props, runJobOperation, selectedTriggerJob, setDialog, showHelpDialog } = ctx();
      const job = selectedTriggerJob();
      if (!job) {
        showHelpDialog("Dead-letter job", "Select a job first.");
        return;
      }
      setDialog({
        confirm() {
          void runJobOperation("Dead-letter job", () => props.controlPlane!.deadLetterTriggerJob({
            error: "Dead-lettered from TUI",
            jobId: job.id,
          }));
        },
        message: `Dead-letter ${job.id}? This records an operator terminal failure.`,
        title: "Dead-letter job",
        variant: "confirm",
      });
    }

  async function runJobOperation(
      title: string,
      action: () => Promise<TriggerJobSnapshot>,
    ) {
  let { navigateTriggerJobs, refreshTriggerRuntime, showErrorDialog, showHelpDialog } = ctx();
      try {
        const updated = await action();
        await refreshTriggerRuntime();
        await navigateTriggerJobs(updated.id);
        showHelpDialog(title, `Updated ${updated.id}: ${updated.status}.`);
      } catch (caught) {
        showErrorDialog(title, caught);
      }
    }

  function showHelpDialog(title: string, message: string) {
    let { setDialog } = ctx();
      setDialog({
        message,
        title,
        variant: "help",
      });
    }

  function showErrorDialog(title: string, caught: unknown) {
    let { setDialog } = ctx();
      setDialog({
        message: caught instanceof Error ? caught.message : String(caught),
        title,
        variant: "error",
      });
    }

  function stepModelSelectionCommands(): ShellCommand[] {
  let { activeModelStep, modelWorkerOptions, selectStepModel } = ctx();
      const step = activeModelStep();
      const models = step?.models ?? [];
      const options = modelWorkerOptions();
      if (!step || models.length === 0 || options.length === 0) return [];
      return models.flatMap((model: any) =>
        options.map((option: any) => ({
          hint: "step-model",
          title: `Use ${option.label ?? option.id} for ${step.label}/${model.label ?? model.operation}`,
          value: `step-model.${step.id}.${model.operation}.${option.id}`,
          run() {
            selectStepModel({
              modelId: option.id,
              operation: model.operation,
              requestedModelId: model.requested?.id,
              stepId: step.id,
            });
          },
        }))
      );
    }

  function selectStepModel(input: {
      modelId: string;
      operation?: string;
      requestedModelId?: string;
      stepId: string;
    }) {
      let { modelWorkerOptions, props, rememberRun, route, selectedWorkflowId, setDialog, setStatus, store, viewedRun } = ctx();
      if (modelWorkerOptions().length === 0) {
        setDialog({
          message: "No model router is configured for this workflow shell.",
          title: "Model selection unavailable",
          variant: "error",
        });
        return;
      }
      const currentRoute = route();
      const run = viewedRun();
      const workflowId = "workflowId" in currentRoute ? currentRoute.workflowId : selectedWorkflowId();
      const updated = props.runtime.selectModelWorker({
        ...input,
        runId: run?.runId,
        workflowId,
      });
      if (updated) {
        rememberRun(updated);
        setStatus(shellStatus(updated.status));
        store().flush();
        return;
      }
      setDialog({
        message: "The model selection was saved and will apply when this step runs.",
        title: "Model selected",
        variant: "help",
      });
    }

  function navigateLibrary(input: { force?: boolean } = {}) {
    let { activeWorkflowBlocksLibraryNavigation, route, setHookRun, setRoute, setSelectedSidebarTab, showWorkflowLibraryBlockedToast } = ctx();
      if (!input.force && route().type !== "library" && activeWorkflowBlocksLibraryNavigation()) {
        showWorkflowLibraryBlockedToast();
        return false;
      }
      setHookRun(undefined);
      setSelectedSidebarTab("config");
      setRoute({ type: "library" });
      return true;
    }

  function navigateStart(workflowId: string) {
    let { props, selectWorkflow, setDetailCollapsedStepIds, setExpandedStartStepIds, setRoute, setSelectedSidebarTab, setSelectedStartCenterTab, setSelectedStartPane, setSelectedStartStepId } = ctx();
      selectWorkflow(workflowId);
      setSelectedStartPane("steps");
      setSelectedStartCenterTab("canvas");
      setSelectedSidebarTab("config");
      setExpandedStartStepIds(new Set<string>());
      setDetailCollapsedStepIds(new Set<string>());
      setSelectedStartStepId(firstDesignNodeId(props.app, workflowId));
      setRoute({ type: "start", workflowId });
    }

  function navigateBackFromRoute(currentRoute: ShellRoute) {
    let { navigateBackFromRouteTarget, props } = ctx();
      if (currentRoute.type === "library") {
        props.onExit();
        return;
      }
      navigateBackFromRouteTarget(currentRoute);
    }

  return { triggerCommands, copySelectedTriggerCurl, copyOpenApiUrl, openSwaggerUi, copySelectedJobId, openSelectedJobRun, retrySelectedJob, confirmSelectedJobCancel, confirmSelectedJobDeadLetter, runJobOperation, showHelpDialog, showErrorDialog, stepModelSelectionCommands, selectStepModel, navigateLibrary, navigateStart, navigateBackFromRoute };
}
