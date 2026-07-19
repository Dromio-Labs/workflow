import type { WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import type { WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { stepDetailTitle } from "./artifact-step-pages.js";
import { stepRuntimeDataContent } from "./step-detail-view.js";
import type { StepInspectorPopupLine, TuiWorkspaceFrame } from "./types.js";

export function runStepInspectorPopupLines(input: {
  snapshot: WorkflowRunStoreSnapshot;
  step: WorkflowRunStoreSnapshot["steps"][number];
  workflow: WorkflowAppWorkflowDescriptor;
  workspaceFrame?: TuiWorkspaceFrame;
}): StepInspectorPopupLine[] {
  const lines: StepInspectorPopupLine[] = [
    { text: `Step: ${stepDetailTitle(input.step)}` },
    { text: `Status: ${input.step.status}` },
    { text: `Workflow: ${input.workflow.title} (${input.workflow.id})` },
  ];
  if (input.workspaceFrame) lines.push({ text: `Workspace: ${input.workspaceFrame.status}` });

  const runtimeData = stepRuntimeDataContent(input.step);
  if (runtimeData) {
    lines.push(
      { text: "" },
      {
        action: {
          content: runtimeData,
          displayPath: `${input.step.id} runtime data`,
          kind: "content",
          path: `${input.step.id}.runtime.json`,
          title: `${stepDetailTitle(input.step)} runtime data`,
        },
        text: "Runtime input and output · enter open",
      },
    );
  }

  const events = input.snapshot.transcript.filter((row) =>
    row.stepId === input.step.id || row.parentStepId === input.step.id
  );
  lines.push({ text: "" }, { text: "Recent events" });
  lines.push(...(events.length > 0
    ? events.slice(-20).map((row) => ({ text: `- ${row.phaseTitle}: ${row.text}` }))
    : [{ text: "- No events recorded for this step." }]));
  return lines;
}
