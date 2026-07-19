import { type RunWorkflowTuiAppOptions } from "../workflow-app-tui.js";
import { formatWorkflowAppResult, type WorkflowApp, type WorkflowAppRun, type WorkflowAppRuntime } from "../workflow-app.js";
import { type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { isEscapeKey } from "./routing-keyboard.js";
import { type ShellStatus } from "./types.js";
import { parseKeypress } from "@opentui/core";
import { release } from "node:os";

export function findWorkflowAppRun(runtime: WorkflowAppRuntime, runId: string | undefined) {
  if (!runId) return undefined;
  try {
    return runtime.getRun(runId);
  } catch {
    return undefined;
  }
}

export function formatTuiRunResult(app: WorkflowApp, run: WorkflowAppRun) {
  if (run.session.status !== "completed") {
    return {
      error: run.session.status === "failed" ? runFailureMessage(run) : "",
      result: "",
    };
  }
  try {
    return {
      error: "",
      result: formatWorkflowAppResult(app.getWorkflow(run.workflowId), run.session),
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return {
      error: `Result formatter failed: ${message}`,
      result: "",
    };
  }
}

export function shellStatus(status: string): ShellStatus {
  if (status === "completed" || status === "failed" || status === "running" || status === "waiting") return status;
  return "idle";
}

export function workflowStepLabelForToast(snapshot: WorkflowRunStoreSnapshot, stepId: string) {
  return snapshot.steps.find((step) => step.id === stepId)?.label ?? stepId;
}

export function runFailureMessage(run: WorkflowAppRun) {
  const failed = [...run.events].reverse().find((event) =>
    event.type === "run.failed" || event.type === "step.failed"
  );
  return failed?.message ?? "Workflow failed.";
}

export function propsOnInterrupt(options: RunWorkflowTuiAppOptions) {
  return options.onInterrupt?.();
}

export function isWorkflowTuiImmediateExitSequence(sequence: string) {
  const key = parseKeypress(Buffer.from(sequence), { useKittyKeyboard: true });
  if (!key || key.eventType === "release") return false;
  if (!key.ctrl || key.meta || key.shift || key.option || key.super || key.hyper) return false;
  return key.name.toLowerCase() === "d";
}

export function isWorkflowTuiEscapeSequence(sequence: string) {
  const key = parseKeypress(Buffer.from(sequence), { useKittyKeyboard: true });
  return Boolean(key && key.eventType !== "release" && isEscapeKey(key));
}
