import { type WorkflowAppRunSnapshot } from "../workflow-app.js";
import { createWorkflowRunStore } from "../workflow-run-store.js";
import { nestedStepById, nestedStepRows } from "./artifact-step-pages.js";
import { clampNumber } from "./command-palette.js";
import { artifactContent, resultArtifactName, selectedArtifactFor } from "./dialogs-popups.js";
import { formFieldCursorEnd, formFieldEditableValue, parsePromptObject } from "./input-form.js";
import { clampIndex } from "./routing-keyboard.js";
import { formatTuiRunResult, shellStatus, workflowStepLabelForToast } from "./runtime-utils.js";
import { type TuiInputForm, type TuiInputFormField } from "./types.js";
import { parentStepIdFromChildStepId, workflowDiagramSelectableStepIds } from "./workflow-design.js";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellHandlerContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellHandlers9(ctx: WorkflowAppTuiShellHandlerContext) {

  function openResultPopup(artifactName?: string) {
    let { installViewedRun, props, rememberRun, setError, setHookRun, setResult, setResultPopup, setResultPopupScrollOffset, setSelectedWorkflowId, setStatus, setViewedRunOrigin, snapshot, updateArtifactsForRun, viewedRun } = ctx();
      const run = viewedRun();
      if (!run) return;
      rememberRun(run);
      setSelectedWorkflowId(run.workflowId);
      installViewedRun(run);
      setViewedRunOrigin(run.origin);
      setStatus(shellStatus(run.status));
      const formatted = formatTuiRunResult(props.app, run);
      setResult(formatted.result);
      setError(formatted.error);
      setHookRun(run.session.pendingHooks?.length ? run : undefined);
      updateArtifactsForRun(run);
      const runArtifacts = run.artifacts ?? [];
      const artifact = selectedArtifactFor(runArtifacts, artifactName);
      const fallbackName = resultArtifactName(props.app, run.workflowId);
      setResultPopup({
        artifact,
        content: artifactContent({
          artifact,
          artifactName: fallbackName,
          error: formatted.error,
          result: formatted.result,
          snapshot: snapshot(),
        }),
        error: formatted.error,
        name: artifact?.name ?? fallbackName,
      });
      setResultPopupScrollOffset(0);
    }

  function viewArtifact(artifactName?: string) {
    let { installViewedRun, props, rememberRun, setError, setHookRun, setResult, setRoute, setSelectedWorkflowId, setStatus, setViewedRunOrigin, updateArtifactsForRun, viewedRun } = ctx();
      const run = viewedRun();
      if (!run) return;
      rememberRun(run);
      setSelectedWorkflowId(run.workflowId);
      installViewedRun(run);
      setViewedRunOrigin(run.origin);
      setStatus(shellStatus(run.status));
      const formatted = formatTuiRunResult(props.app, run);
      setResult(formatted.result);
      setError(formatted.error);
      setHookRun(run.session.pendingHooks?.length ? run : undefined);
      setRoute({
        artifactName,
        runId: run.runId,
        type: "artifact",
        workflowId: run.workflowId,
      });
      updateArtifactsForRun(run);
    }

  function viewStep(stepId: string) {
    let { installViewedRun, prepareSelectedStepForDetail, props, rememberRun, route, setError, setHookRun, setResult, setRoute, setSelectedWorkflowId, setStatus, setViewedRunOrigin, viewedRun } = ctx();
      prepareSelectedStepForDetail(stepId);
      const currentRoute = route();
      if (
        currentRoute.type === "start" ||
        (currentRoute.type === "step" && !currentRoute.runId)
      ) {
        setSelectedWorkflowId(currentRoute.workflowId);
        setRoute({ stepId, type: "step", workflowId: currentRoute.workflowId });
        return;
      }
      const run = viewedRun();
      if (!run) return;
      rememberRun(run);
      setSelectedWorkflowId(run.workflowId);
      installViewedRun(run);
      setViewedRunOrigin(run.origin);
      setStatus(shellStatus(run.status));
      const formatted = formatTuiRunResult(props.app, run);
      setResult(formatted.result);
      setError(formatted.error);
      setHookRun(run.session.pendingHooks?.length ? run : undefined);
      setRoute({ runId: run.runId, stepId, type: "step", workflowId: run.workflowId });
    }

  function viewRunSnapshot(run: WorkflowAppRunSnapshot) {
    let { installViewedRunSnapshot, isActiveWorkflowStatus, lastRunIdsByWorkflow, setArtifacts, setError, setHookRun, setLastViewedRunId, setResult, setRoute, setSelectedSidebarTab, setSelectedWorkflowId, setStatus, setViewedRunOrigin } = ctx();
      lastRunIdsByWorkflow.set(run.workflowId, run.runId);
      setLastViewedRunId(run.runId);
      setSelectedWorkflowId(run.workflowId);
      installViewedRunSnapshot(run);
      setViewedRunOrigin(run.origin);
      setStatus(shellStatus(run.status));
      setResult(run.result ?? "");
      setError(run.artifactError ?? (run.status === "failed" ? "Workflow failed." : ""));
      setHookRun(undefined);
      setArtifacts(run.artifacts ?? []);
      if (isActiveWorkflowStatus(run.status)) setSelectedSidebarTab("activity");
      setRoute({ type: "run", runId: run.runId, workflowId: run.workflowId });
    }

  function selectWorkflow(workflowId: string) {
    let { installStore, props, setArtifacts, setError, setResult, setSelectedWorkflowId, setStatus, setViewedRunOrigin, status, unsubscribeRun, workflowIds } = ctx();
      if (!workflowIds().includes(workflowId)) return;
      setSelectedWorkflowId(workflowId);
      if (status() === "idle" || status() === "completed" || status() === "failed") {
        unsubscribeRun?.();
        unsubscribeRun = undefined;
        installStore(createWorkflowRunStore({
          graph: props.app.graph(workflowId),
        }));
        setResult("");
        setError("");
        setArtifacts([]);
        setViewedRunOrigin(undefined);
        setStatus("idle");
      }
    }

  function selectWorkflowIndex(index: number, ids?: string[]) {
  let { selectWorkflow, workflowIds } = ctx();
      const effectiveIds = ids ?? workflowIds();
      if (effectiveIds.length === 0) return;
      const next = effectiveIds[(index + effectiveIds.length) % effectiveIds.length];
      if (next) selectWorkflow(next);
    }

  function selectStartStep(delta: -1 | 1) {
    let { selectStartStepId, selectedStartStepId, startStepOutlineItems } = ctx();
      const nodeIds = startStepOutlineItems().map((item: any) => item.id);
      if (nodeIds.length === 0) return;
      const currentIndex = Math.max(0, nodeIds.indexOf(selectedStartStepId() ?? ""));
      const next = nodeIds[(currentIndex + delta + nodeIds.length) % nodeIds.length];
      if (next) selectStartStepId(next);
    }

  function selectStartStepBoundary(boundary: "first" | "last") {
    let { selectStartStepId, startStepOutlineItems } = ctx();
      const nodeIds = startStepOutlineItems().map((item: any) => item.id);
      const next = boundary === "first" ? nodeIds[0] : nodeIds.at(-1);
      if (next) selectStartStepId(next);
    }

  function selectStartCanvasStep(delta: -1 | 1) {
    let { selectStartStepId, selectedStartStepId, startDesignGraph } = ctx();
      const graph = startDesignGraph();
      const nodeIds = workflowDiagramSelectableStepIds(graph);
      if (nodeIds.length === 0) return;
      const current = selectedStartStepId() ?? nodeIds[0]!;
      const connected = delta > 0
        ? graph.edges.find((edge: any) => edge.from === current)?.to
        : [...graph.edges].reverse().find((edge) => edge.to === current)?.from;
      if (connected && nodeIds.includes(connected)) {
        selectStartStepId(connected);
        return;
      }
      const currentIndex = Math.max(0, nodeIds.indexOf(current));
      const next = nodeIds[(currentIndex + delta + nodeIds.length) % nodeIds.length];
      if (next) selectStartStepId(next);
    }

  function selectStartCanvasBoundary(boundary: "first" | "last") {
    let { selectStartStepId, startDesignGraph } = ctx();
      const nodeIds = workflowDiagramSelectableStepIds(startDesignGraph());
      const next = boundary === "first" ? nodeIds[0] : nodeIds.at(-1);
      if (next) selectStartStepId(next);
    }

  function selectStartStepId(stepId: string) {
    let { setSelectedStartStepId, setStartStepExpanded } = ctx();
      const parentStepId = parentStepIdFromChildStepId(stepId);
      if (parentStepId) setStartStepExpanded(parentStepId, true);
      setSelectedStartStepId(stepId);
    }

  function selectStartDiagramStepId(stepId: string) {
    let { selectStartStepId, setSelectedStartCenterTab, setSelectedStartPane } = ctx();
      selectStartStepId(stepId);
      setSelectedStartCenterTab("canvas");
      setSelectedStartPane("canvas");
    }

  function expandSelectedStartStep() {
    let { selectedStartOutlineItem, setStartStepExpanded } = ctx();
      const item = selectedStartOutlineItem();
      if (!item?.expandable) return;
      setStartStepExpanded(item.id, true);
    }

  function collapseSelectedStartStep() {
    let { selectStartStepId, selectedStartOutlineItem, setStartStepExpanded } = ctx();
      const item = selectedStartOutlineItem();
      if (!item) return;
      if (item.parentId) {
        selectStartStepId(item.parentId);
        return;
      }
      if (item.expandable) setStartStepExpanded(item.id, false);
    }

  function prepareSelectedStepForDetail(stepId: string) {
    let { selectStartStepId, setDetailStepCollapsed, stepDetailParentStepId } = ctx();
      const parentStepId = stepDetailParentStepId(stepId) ?? parentStepIdFromChildStepId(stepId);
      if (parentStepId) setDetailStepCollapsed(parentStepId, false);
      selectStartStepId(stepId);
    }

  function selectStepDetailStep(delta: -1 | 1) {
    let { selectStepDetailStepId, selectedStepDetailStepId, visibleStepDetailStepIds } = ctx();
      const stepIds = visibleStepDetailStepIds();
      if (stepIds.length === 0) return;
      const currentStepId = selectedStepDetailStepId();
      const currentIndex = Math.max(0, stepIds.indexOf(currentStepId ?? ""));
      const next = stepIds[(currentIndex + delta + stepIds.length) % stepIds.length];
      if (next) selectStepDetailStepId(next);
    }

  function selectStepDetailBoundary(boundary: "first" | "last") {
    let { selectStepDetailStepId, visibleStepDetailStepIds } = ctx();
      const stepIds = visibleStepDetailStepIds();
      const next = boundary === "first" ? stepIds[0] : stepIds.at(-1);
      if (next) selectStepDetailStepId(next);
    }

  function selectedStepDetailTarget() {
    let { selectedStepDetailStepId, snapshot } = ctx();
      const currentSnapshot = snapshot();
      const stepId = selectedStepDetailStepId();
      return currentSnapshot.steps.find((step: any) => step.id === stepId) ??
        nestedStepById(currentSnapshot, stepId) ??
        currentSnapshot.currentStep ??
        currentSnapshot.steps[0];
    }

  function openSelectedStepRuntimeData() {
    let { openStepRuntimeDataViewer, selectedStepDetailTarget } = ctx();
      const step = selectedStepDetailTarget();
      if (step) openStepRuntimeDataViewer(step);
    }

  function selectStepDetailStepId(stepId: string) {
    let { prepareSelectedStepForDetail, route, setRoute } = ctx();
      prepareSelectedStepForDetail(stepId);
      const currentRoute = route();
      if (currentRoute.type !== "step") return;
      setRoute({ ...currentRoute, stepId });
    }

  function collapseSelectedDetailStep() {
    let { selectStepDetailStepId, selectedStepDetailStepId, setDetailStepCollapsed, stepDetailParentStepId, stepDetailStepHasChildren } = ctx();
      const stepId = selectedStepDetailStepId();
      if (!stepId) return;
      const parentStepId = stepDetailParentStepId(stepId);
      if (parentStepId) {
        selectStepDetailStepId(parentStepId);
        return;
      }
      if (stepDetailStepHasChildren(stepId)) setDetailStepCollapsed(stepId, true);
    }

  function expandSelectedDetailStep() {
    let { selectedStepDetailStepId, setDetailStepCollapsed, stepDetailStepHasChildren } = ctx();
      const stepId = selectedStepDetailStepId();
      if (!stepId || !stepDetailStepHasChildren(stepId)) return;
      setDetailStepCollapsed(stepId, false);
    }

  function visibleStepDetailStepIds() {
    let { detailCollapsedStepIds, snapshot } = ctx();
      const currentSnapshot = snapshot();
      const collapsed = detailCollapsedStepIds();
      return currentSnapshot.steps.flatMap((step: any) => {
        if (collapsed.has(step.id)) return [step.id];
        return [step.id, ...nestedStepRows(currentSnapshot, step).map((child) => child.id)];
      });
    }

  function selectedStepDetailStepId() {
    let { route, selectedStartStepId } = ctx();
      const currentRoute = route();
      return currentRoute.type === "step" ? currentRoute.stepId : selectedStartStepId();
    }

  function stepDetailParentStepId(stepId: string) {
    let { snapshot } = ctx();
      const parentStepId = parentStepIdFromChildStepId(stepId);
      if (parentStepId) return parentStepId;
      const currentSnapshot = snapshot();
      for (const step of currentSnapshot.steps) {
        if (nestedStepRows(currentSnapshot, step).some((child) => child.id === stepId)) return step.id;
      }
      return undefined;
    }

  function stepDetailStepHasChildren(stepId: string) {
    let { snapshot } = ctx();
      const currentSnapshot = snapshot();
      const step = currentSnapshot.steps.find((candidate: any) => candidate.id === stepId);
      return Boolean(step && nestedStepRows(currentSnapshot, step).length > 0);
    }

  function setDetailStepCollapsed(stepId: string, collapsed: boolean) {
    let { setDetailCollapsedStepIds } = ctx();
      setDetailCollapsedStepIds((previous: ReadonlySet<string>) => {
        const next = new Set<string>(previous);
        if (collapsed) next.add(stepId);
        else next.delete(stepId);
        return next;
      });
    }

  function toggleDetailStepCollapsed(stepId: string) {
    let { setDetailCollapsedStepIds } = ctx();
      setDetailCollapsedStepIds((previous: ReadonlySet<string>) => {
        const next = new Set<string>(previous);
        if (next.has(stepId)) next.delete(stepId);
        else next.add(stepId);
        return next;
      });
    }

  function setStartStepExpanded(stepId: string, expanded: boolean) {
    let { setExpandedStartStepIds } = ctx();
      setExpandedStartStepIds((previous: ReadonlySet<string>) => {
        const next = new Set<string>(previous);
        if (expanded) next.add(stepId);
        else next.delete(stepId);
        return next;
      });
    }

  function selectInputField(delta: -1 | 1, form: TuiInputForm) {
    let { setPromptCursor, setSelectedInputFieldIndex } = ctx();
      setSelectedInputFieldIndex((index: number) => {
        const next = clampIndex(index + delta, form.fields.length);
        setPromptCursor(formFieldCursorEnd(form.fields[next]));
        return next;
      });
    }

  function moveFormFieldCursor(field: TuiInputFormField, delta: number) {
    let { setPromptCursor } = ctx();
      setPromptCursor((cursor: number) => clampNumber(cursor + delta, 0, formFieldEditableValue(field).length));
    }

  function editFormFieldDraft(
      form: TuiInputForm,
      field: TuiInputFormField,
      editor: (value: string, cursor: number) => { cursor: number; value: string },
    ) {
  let { promptCursor, setFormFieldValue } = ctx();
      if (field.type === "checkbox") return;
      const current = formFieldEditableValue(field);
      const cursor = clampNumber(promptCursor(), 0, current.length);
      const next = editor(current, cursor);
      setFormFieldValue(form, field, next.value, next.cursor);
    }

  function setFormFieldValue(
      form: TuiInputForm,
      field: TuiInputFormField,
      value: boolean | string,
      cursor?: number,
    ) {
  let { prompt, promptCursor, replacePromptDraft } = ctx();
      const nextCursor = cursor ?? (typeof value === "string" ? value.length : promptCursor());
      if (form.kind === "text") {
        replacePromptDraft(String(value), nextCursor);
        return;
      }
      const object = parsePromptObject(prompt());
      if (field.type === "checkbox") {
        object[field.name] = Boolean(value);
      } else {
        const next = String(value);
        if (next) object[field.name] = next;
        else delete object[field.name];
      }
      replacePromptDraft(JSON.stringify(object), nextCursor);
    }

  function rememberPromptHistory(value: string) {
    let { promptHistory, resetPromptHistoryBrowse } = ctx();
      const trimmed = value.trim();
      if (!trimmed) return;
      const existing = promptHistory.indexOf(trimmed);
      if (existing >= 0) promptHistory.splice(existing, 1);
      promptHistory.push(trimmed);
      while (promptHistory.length > 50) promptHistory.shift();
      resetPromptHistoryBrowse();
    }

  return { openResultPopup, viewArtifact, viewStep, viewRunSnapshot, selectWorkflow, selectWorkflowIndex, selectStartStep, selectStartStepBoundary, selectStartCanvasStep, selectStartCanvasBoundary, selectStartStepId, selectStartDiagramStepId, expandSelectedStartStep, collapseSelectedStartStep, prepareSelectedStepForDetail, selectStepDetailStep, selectStepDetailBoundary, selectedStepDetailTarget, openSelectedStepRuntimeData, selectStepDetailStepId, collapseSelectedDetailStep, expandSelectedDetailStep, visibleStepDetailStepIds, selectedStepDetailStepId, stepDetailParentStepId, stepDetailStepHasChildren, setDetailStepCollapsed, toggleDetailStepCollapsed, setStartStepExpanded, selectInputField, moveFormFieldCursor, editFormFieldDraft, setFormFieldValue, rememberPromptHistory };
}
