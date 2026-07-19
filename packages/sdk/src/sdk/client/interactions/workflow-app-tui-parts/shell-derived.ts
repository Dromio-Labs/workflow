import { workflowTuiTriggerBoundarySummary } from "../workflow-app-tui.js";
import { runDurationText } from "./activity-table.js";
import { workflowStartInputForm } from "./input-form.js";
import { workflowLibraryAppQueryWorkflowIds, workflowLibrarySelectableWorkflowIds } from "./library-view.js";
import { workflowCanvasGraph } from "./sidebar.js";
import { LAYOUT } from "./style.js";
import { type TuiInputMode } from "./types.js";
import { workflowStartOutlineItems } from "./workflow-design.js";
import { defaultWorkflowExportFields } from "./workflow-export.js";
import { metadataSelectionRows } from "./workflow-file-helpers.js";
import { createMemo } from "solid-js";
import { type WorkflowAppTuiShellContextValue } from "./shell-context.js";

export type WorkflowAppTuiShellDerivedContext = Pick<
  WorkflowAppTuiShellContextValue,
  | "appListings"
  | "dimensions"
  | "expandedStartStepIds"
  | "inputModeByWorkflow"
  | "lastViewedRunId"
  | "libraryViewMode"
  | "prompt"
  | "props"
  | "route"
  | "runById"
  | "selectedJobIndex"
  | "selectedStartStepId"
  | "selectedTriggerIndex"
  | "selectedWorkflow"
  | "selectedWorkflowId"
  | "selectedWorkflowRun"
  | "selectedWorkspaceFrame"
  | "snapshot"
  | "status"
  | "triggerJobs"
  | "triggers"
  | "workflowIds"
  | "workflowQuery"
  | "workflows"
>;

export function createWorkflowAppTuiShellDerived(ctx: WorkflowAppTuiShellDerivedContext) {
  const { appListings, dimensions, expandedStartStepIds, inputModeByWorkflow, lastViewedRunId, libraryViewMode, prompt, props, route, runById, selectedJobIndex, selectedStartStepId, selectedTriggerIndex, selectedWorkflow, selectedWorkflowId, selectedWorkflowRun, selectedWorkspaceFrame, snapshot, status, triggerJobs, triggers, workflowIds, workflowQuery, workflows } = ctx;
  const activeRunHeaderMeta = createMemo(() => {
      if (route().type !== "run") return undefined;
      const parts = [
        snapshot().runId ? `run: ${snapshot().runId}` : "",
        `mode: ${selectedWorkflow().id}`,
        runDurationText(snapshot(), status()),
        status() === "waiting" ? "●" : "●",
      ].filter(Boolean);
      return parts.join("   ");
    });
  const showSidebar = createMemo(() =>
      dimensions().width >= LAYOUT.sidebarMinVisibleWidth && route().type !== "start"
    );
  const showStartDiagramPane = createMemo(() => dimensions().width >= LAYOUT.diagramMinVisibleWidth);
  const selectedWorkflowIndex = createMemo(() => Math.max(0, workflowIds().indexOf(selectedWorkflowId())));
  const filteredWorkflows = createMemo(() => {
      const query = workflowQuery().trim().toLowerCase();
      if (!query) return workflows();
      if (libraryViewMode() === "apps") {
        const appWorkflowIds = workflowLibraryAppQueryWorkflowIds(appListings(), workflows(), query);
        if (appWorkflowIds.size > 0) return workflows().filter((workflow: any) => appWorkflowIds.has(workflow.id));
      }
      return workflows().filter((workflow: any) =>
        workflow.id.toLowerCase().includes(query) ||
        workflow.title.toLowerCase().includes(query) ||
        workflow.description?.toLowerCase().includes(query)
      );
    });
  const libraryWorkflowIds = createMemo(() => workflowLibrarySelectableWorkflowIds(
      filteredWorkflows(),
      appListings(),
      libraryViewMode(),
    ));
  const selectedLibraryIndex = createMemo(() => Math.max(0, libraryWorkflowIds().indexOf(selectedWorkflowId())));
  const workflowExportFields = createMemo(() => props.exportWorkflows?.fields ?? defaultWorkflowExportFields());
  const selectedTrigger = createMemo(() => triggers()[selectedTriggerIndex()]);
  const startDesignGraph = createMemo(() =>
      workflowCanvasGraph(
        selectedWorkflow(),
        selectedWorkspaceFrame(),
        props.app.graph(selectedWorkflowId()),
      )
    );
  const startStepOutlineItems = createMemo(() =>
      workflowStartOutlineItems(startDesignGraph(), expandedStartStepIds())
    );
  const selectedStartOutlineItem = createMemo(() =>
      startStepOutlineItems().find((item) => item.id === selectedStartStepId())
    );
  const startWorkflowTriggerSummary = createMemo(() => {
      const currentRoute = route();
      if (currentRoute.type !== "start") return undefined;
      const graph = startDesignGraph();
      return workflowTuiTriggerBoundarySummary({
        trigger: graph.trigger,
        triggers: triggers(),
        workflowId: selectedWorkflowId(),
      });
    });
  const selectedStartTriggerSummary = createMemo(() => {
      const currentRoute = route();
      if (currentRoute.type !== "start") return undefined;
      const graph = startDesignGraph();
      const step = selectedStartOutlineItem()?.node;
      if (step?.boundary !== "trigger") return undefined;
      return workflowTuiTriggerBoundarySummary({
        trigger: graph.trigger ?? {
          id: step.id,
          type: step.triggerType,
        },
        triggers: triggers(),
        workflowId: selectedWorkflowId(),
      });
    });
  const selectedMetadataRows = createMemo(() =>
      metadataSelectionRows({
        inputDraft: prompt(),
        selectedStep: selectedStartOutlineItem()?.node,
        selectedTriggerSummary: selectedStartTriggerSummary(),
        workspaceFrame: selectedWorkspaceFrame(),
        workflow: selectedWorkflow(),
      })
    );
  const startInputForm = createMemo(() =>
      workflowStartInputForm({
        prompt: prompt(),
        summary: startWorkflowTriggerSummary(),
        workflow: selectedWorkflow(),
      })
    );
  const selectedStartInputMode = createMemo<TuiInputMode>(() => inputModeByWorkflow()[selectedWorkflowId()] ?? "render");
  const visibleStartInputForm = createMemo(() => selectedStartInputMode() === "render" ? startInputForm() : undefined);
  const selectedTriggerJob = createMemo(() => {
      const currentRoute = route();
      if (currentRoute.type === "triggerJobs" && currentRoute.jobId) {
        return triggerJobs().find((job: any) => job.id === currentRoute.jobId) ?? triggerJobs()[selectedJobIndex()];
      }
      return triggerJobs()[selectedJobIndex()];
    });
  const latestRun = () => props.runtime.listRuns().at(-1);
  const modelWorkerOptions = createMemo(() => props.runtime.listModelWorkers());
  const viewedRun = () => {
      const current = route();
      if ("runId" in current && current.runId) {
        const run = runById(current.runId);
        if (run) return run;
      }
      if (current.type === "library" || current.type === "start") return selectedWorkflowRun();
      return selectedWorkflowRun() ?? runById(lastViewedRunId()) ?? latestRun();
    };
  const activeModelStep = () => {
      const current = route();
      const stepId = current.type === "step" ? current.stepId : snapshot().currentStepId;
      if (!stepId) return undefined;
      const step = snapshot().steps.find((item: any) => item.id === stepId);
      return step?.boundary ? undefined : step;
    };

  return { activeRunHeaderMeta, showSidebar, showStartDiagramPane, selectedWorkflowIndex, filteredWorkflows, libraryWorkflowIds, selectedLibraryIndex, workflowExportFields, selectedTrigger, startDesignGraph, startStepOutlineItems, selectedStartOutlineItem, startWorkflowTriggerSummary, selectedStartTriggerSummary, selectedMetadataRows, startInputForm, selectedStartInputMode, visibleStartInputForm, selectedTriggerJob, latestRun, modelWorkerOptions, viewedRun, activeModelStep };
}
