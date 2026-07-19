import type { WorkflowViewCommand } from "@dromio/workflow-room-protocol";
import type { EventRecord } from "../../../core/index.js";
import type { WorkflowAppRun } from "../workflow-app.js";
import type { WorkflowRunStore } from "../workflow-run-store.js";
import { renderedJsonFormPrompt, renderedJsonFormValidation } from "./input-form.js";
import { parseHookInput } from "./routing-keyboard.js";
import { formatTuiRunResult } from "./runtime-utils.js";
import type { WorkflowAppTuiShellContext } from "./shell-context.js";
import { workflowAppTuiHookResumeCommand } from "./workflow-view-commands.js";

export type WorkflowAppTuiShellHandlerContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellHandlers13(ctx: WorkflowAppTuiShellHandlerContext) {
  function startInputValidation(): { fieldIndex: number; message: string } | undefined {
    const { prompt, route, selectedStartInputMode, startInputForm } = ctx();
    if (route().type !== "start" || selectedStartInputMode() !== "render") return undefined;
    const form = startInputForm();
    return form?.kind === "json" ? renderedJsonFormValidation(form, prompt()) : undefined;
  }

  function promptTextForStartSubmission() {
    const { prompt, route, selectedStartInputMode, startInputForm } = ctx();
    if (route().type !== "start" || selectedStartInputMode() !== "render") return prompt();
    const form = startInputForm();
    return form?.kind === "json" ? renderedJsonFormPrompt(form, prompt()) : prompt();
  }

  function workspaceTestPromptInput() {
    const { prompt, route, selectedStartInputMode, startInputForm } = ctx();
    if (route().type === "start" && selectedStartInputMode() === "render") {
      const form = startInputForm();
      if (form?.kind === "json") return renderedJsonFormPrompt(form, prompt());
    }
    return prompt().trim() || "test";
  }

  async function submitHookValue() {
    const {
      continueRun, hookRun, hookValue, props, setDialog, setError, setHookRun,
      setHookValue, setSelectedSidebarTab, setStatus, store,
    } = ctx();
    const current = hookRun();
    const hook = current?.session.pendingHooks?.[0];
    if (!current || !hook) return;
    const command = workflowAppTuiHookResumeCommand({
      hook,
      runId: current.runId,
      value: parseHookInput(hookValue()),
    });
    setHookRun(undefined);
    setHookValue("");
    setError("");
    setStatus("running");
    setSelectedSidebarTab("activity");
    try {
      appendWorkflowViewCommandEvent(current, command, store());
      const resumed = await props.runtime.resumeHook({ token: command.token, value: command.value });
      store().flush();
      await continueRun(resumed, current.workflowId, store());
    } catch (caught) {
      setStatus("failed");
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setDialog({ message, title: "Resume failed", variant: "error" });
    }
  }

  function appendWorkflowViewCommandEvent(
    run: WorkflowAppRun,
    command: WorkflowViewCommand,
    runStore: WorkflowRunStore,
  ) {
    const index = (run.events.at(-1)?.index ?? -1) + 1;
    const event: EventRecord = {
      correlationId: `run:${run.runId}:workflow-view-command:${index}`,
      detail: { command },
      index,
      message: `Submitted workflow view command ${command.type}.`,
      runId: run.runId,
      timestamp: new Date().toISOString(),
      trace: {
        attributes: {
          eventType: "workflow.ui.command",
          source: command.source?.surface ?? "tui",
          workflowId: run.workflowId,
        },
        kind: "client",
        name: "workflow.ui.command",
        parentSpanId: `run:${run.runId}`,
        spanId: `workflow-view-command:${index}`,
        status: "ok",
        traceId: run.runId,
      },
      type: "workflow.ui.command",
    };
    run.events.push(event);
    runStore.push(event);
  }

  async function continueRun(run: WorkflowAppRun, workflowId: string, runStore: WorkflowRunStore) {
    const {
      props, questionController, rememberRun, route, setError, setHookRun, setResult,
      setRoute, setSelectedSidebarTab, setStatus, updateArtifactsForRun,
    } = ctx();
    let current = run;
    rememberRun(current);
    while (current.session.status === "waiting") {
      if (current.session.pendingQuestions.length === 0) {
        if (current.session.pendingHooks?.length) {
          rememberRun(current);
          setStatus("waiting");
          setSelectedSidebarTab("activity");
          setHookRun(current);
          setRoute({ type: "run", runId: current.runId, workflowId });
          setError("");
          return;
        }
        setStatus("waiting");
        setError("Workflow is waiting, but no resumable hook was reported.");
        return;
      }
      setStatus("waiting");
      setSelectedSidebarTab("activity");
      setHookRun(undefined);
      rememberRun(current);
      setRoute({ type: "run", runId: current.runId, workflowId });
      const answered = await questionController.ask({
        pendingQuestions: current.session.pendingQuestions,
        status: current.session.status,
        answer(answer: { questionId: string; value: unknown }) {
          return props.runtime.answerQuestion(current.runId, answer);
        },
        resume() {
          return props.runtime.resumeRun(current.runId);
        },
      }, {
        emptyAnswerHint: props.emptyAnswerHint ?? "Press Enter to let the workflow make a sensible assumption.",
        interactive: true,
      });
      if (!answered) {
        setError("Answer required before the workflow can continue.");
        continue;
      }
      setError("");
      current = await props.runtime.resumeRun(current.runId);
      rememberRun(current);
      runStore.flush();
    }
    setHookRun(undefined);
    rememberRun(current);
    setStatus(current.session.status === "completed" ? "completed" : "failed");
    setSelectedSidebarTab("config");
    const formatted = formatTuiRunResult(props.app, current);
    setResult(formatted.result);
    setError(formatted.error);
    updateArtifactsForRun(current);
    const currentRoute = route();
    setRoute(currentRoute.type === "step" && currentRoute.runId === current.runId
      ? { ...currentRoute, workflowId }
      : { type: "run", runId: current.runId, workflowId });
  }

  function rememberRun(run: WorkflowAppRun) {
    const { lastRunIdsByWorkflow, setLastViewedRunId } = ctx();
    lastRunIdsByWorkflow.set(run.workflowId, run.runId);
    setLastViewedRunId(run.runId);
  }

  function selectedWorkflowRun() {
    const { lastRunIdsByWorkflow, props, runById, selectedWorkflowId } = ctx();
    const workflowId = selectedWorkflowId();
    return runById(lastRunIdsByWorkflow.get(workflowId)) ??
      props.runtime.listRuns().filter((run) => run.workflowId === workflowId).at(-1);
  }

  function runById(runId: string | undefined) {
    if (!runId) return undefined;
    try {
      return ctx().props.runtime.getRun(runId);
    } catch {
      return undefined;
    }
  }

  return {
    continueRun,
    promptTextForStartSubmission,
    rememberRun,
    runById,
    selectedWorkflowRun,
    startInputValidation,
    submitHookValue,
    workspaceTestPromptInput,
  };
}
