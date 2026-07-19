import type {
  WorkflowControlPlane,
} from "../types.js";

export type CreateWorkflowControlPlaneHttpAdapterInput = {
  basePath?: string;
  controlPlane: WorkflowControlPlane;
  swagger?: {
    auth?: "bearer" | "public";
  };
};

export type WorkflowControlPlaneHttpAdapter = {
  fetch(request: Request): Promise<Response>;
};

export type RouteMatch =
  | { route: "answerQuestion"; questionId: string; runId: string }
  | { route: "getOpenApi" }
  | { route: "getRun"; runId: string }
  | { route: "getRunEvents"; runId: string }
  | { route: "getSignal"; signalId: string }
  | { route: "getSignalOccurrence"; occurrenceId: string }
  | { route: "getSwagger" }
  | { route: "getTrigger"; triggerId: string }
  | { route: "getTriggerForm"; triggerId: string }
  | { route: "getTriggerJob"; jobId: string }
  | { route: "getTriggerJobEvents"; jobId: string }
  | { route: "invokeTrigger"; triggerId: string }
  | { route: "publishSignalOccurrence"; signalId: string }
  | { route: "retryTriggerJob"; jobId: string }
  | { route: "resumeHook"; token: string }
  | { route: "resumeRun"; runId: string }
  | { route: "startRun" }
  | { route: "deadLetterTriggerJob"; jobId: string }
  | { route: "cancelTriggerJob"; jobId: string }
  | { route: "listRuns" }
  | { route: "listSignals" }
  | { route: "listTriggerJobs" }
  | { route: "listTriggers" }
  | { route: "listWorkflows" };
