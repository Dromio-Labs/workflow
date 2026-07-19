import {
  createWorkflowHookResumeCommand,
  type WorkflowHookRequest,
  type WorkflowHookResumeCommand,
} from "@dromio/workflow-room-protocol";
import type { HookRequest } from "../../../core/index.js";
import { projectHookRequest } from "../../workflow-room/projection.js";
import { toWorkflowRoomJsonValue } from "../../workflow-room/json.js";

export function workflowAppTuiHookResumeCommand(input: {
  hook: HookRequest | WorkflowHookRequest;
  runId: string;
  value: unknown;
}): WorkflowHookResumeCommand {
  const hook = projectHookRequest(input.hook);
  const command = createWorkflowHookResumeCommand(hook, {
    requestId: `tui:${input.runId}:${hook.token}`,
    runId: input.runId,
    source: {
      adapterId: "dromio-workbench-tui",
      surface: "tui",
    },
    value: toWorkflowRoomJsonValue(input.value),
  });
  if (!command) {
    throw new Error(`Workflow hook ${input.hook.id} cannot be resumed without a run id and token.`);
  }
  return command;
}
