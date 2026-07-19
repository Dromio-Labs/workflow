import type { WorkflowViewSnapshot } from "@dromio/workflow-room-protocol";
import type {
  WorkflowApp,
  WorkflowAppRun,
} from "../workflow-app.js";
import {
  workflowViewSnapshotFromWorkflowAppRun,
} from "../workflow-app-view-snapshot.js";
import {
  workflowViewProtocolFixtureSnapshot,
} from "./workflow-view-protocol-lines.js";

export function workflowAppTuiProtocolSnapshot(input: {
  app: WorkflowApp;
  fixture?: string;
  run?: WorkflowAppRun;
  selectedStepId?: string;
  workflowId: string;
}): WorkflowViewSnapshot | undefined {
  if (input.run?.workflowId === input.workflowId) {
    return workflowViewSnapshotFromWorkflowAppRun({
      app: input.app,
      run: input.run,
      selectedStepId: input.selectedStepId,
    });
  }
  return workflowViewProtocolFixtureSnapshot({
    fixture: input.fixture,
    workflowId: input.workflowId,
  });
}
