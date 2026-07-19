import { describe, expect, test } from "bun:test";
import {
  applyWorkflowViewCommandResultToMetadata,
  createWorkflowViewCommandResult,
  workflowViewCommandDispatchDescription,
  workflowViewCommandStateFromWorkflowView,
  workflowViewCommandResultKey,
  workflowViewCommandResultToJsonRenderDocument,
  workflowViewSubmittedHookTokensFromCommandResults,
  workflowViewCommandTargetId,
  type WorkflowViewCommandResult,
} from "../src/index.js";

describe("workflow view command result helpers", () => {
  test("creates canonical command dispatch results for first-party adapters", () => {
    const command = {
      runId: "run-process-images",
      token: "hook-token-1",
      type: "workflow.hook.resume",
      value: { approved: true },
    } as const;

    expect(workflowViewCommandTargetId(command)).toBe("run-process-images");
    expect(createWorkflowViewCommandResult({
      command,
      dispatch: { mode: "runtime" },
    })).toMatchObject({
      accepted: true,
      dispatch: {
        mode: "runtime",
        runtimeResumed: true,
        status: "dispatched",
        targetId: "run-process-images",
      },
    });
    expect(createWorkflowViewCommandResult({
      command,
      dispatch: { mode: "linked-run-metadata" },
    })).toMatchObject({
      dispatch: {
        mode: "linked-run-metadata",
        runtimeResumed: false,
        status: "recorded",
      },
    });
    expect(createWorkflowViewCommandResult({
      command,
      dispatch: { mode: "watson-trace" },
    })).toMatchObject({
      dispatch: {
        mode: "watson-trace",
        runtimeResumed: false,
        status: "recorded",
      },
    });
  });

  test("creates rejected command results without claiming runtime resume", () => {
    const result = createWorkflowViewCommandResult({
      accepted: false,
      command: {
        runId: "run-process-images",
        token: "hook-token-1",
        type: "workflow.hook.resume",
        value: { approved: true },
      },
      dispatch: { mode: "runtime" },
      error: {
        code: "WORKFLOW_UI_COMMAND_FAILED",
        message: "Hook is already closed.",
      },
    });

    expect(result).toMatchObject({
      accepted: false,
      dispatch: {
        mode: "runtime",
        runtimeResumed: false,
        status: "rejected",
        targetId: "run-process-images",
      },
    });
  });

  test("creates stable command result keys", () => {
    expect(workflowViewCommandResultKey(commandResult())).toBe(
      "workflow.hook.resume:run-process-images:hook-token-1",
    );
  });

  test("formats dispatch descriptions consistently across adapters", () => {
    expect(workflowViewCommandDispatchDescription(commandResult())).toBe(
      "Watson trace · recorded · runtime not resumed",
    );
  });

  test("projects command results into JSON Render CommandStatus documents", () => {
    expect(workflowViewCommandResultToJsonRenderDocument(commandResult())).toEqual({
      component: "CommandStatus",
      props: {
        accepted: true,
        commandType: "workflow.hook.resume",
        dispatchMode: "Watson trace",
        dispatchStatus: "recorded",
        runtimeLabel: "runtime not resumed",
        runtimeResumed: false,
        status: "accepted",
        targetId: "run-process-images",
      },
    });
  });

  test("includes rejected command error messages", () => {
    expect(workflowViewCommandResultToJsonRenderDocument({
      accepted: false,
      command: {
        runId: "run-process-images",
        token: "hook-token-1",
        type: "workflow.hook.resume",
        value: { approved: true },
      },
      error: {
        code: "WORKFLOW_UI_COMMAND_FAILED",
        message: "Hook is already closed.",
      },
    })).toMatchObject({
      component: "CommandStatus",
      props: {
        errorMessage: "Hook is already closed.",
        runtimeLabel: "runtime not dispatched",
        status: "rejected",
      },
    });
  });

  test("applies accepted hook results to canonical workflow view state", () => {
    const command = {
      requestId: "platform:run-process-images:hook-token-1",
      runId: "run-process-images",
      source: { surface: "platform" },
      token: "hook-token-1",
      type: "workflow.hook.resume",
      value: { approved: true },
    } as const;
    const result = createWorkflowViewCommandResult({
      command,
      dispatch: { mode: "linked-run-metadata" },
    });

    const metadata = applyWorkflowViewCommandResultToMetadata(
      {
        workflowView: {
          pendingHooks: [{
            id: "approve-image-batch",
            runId: "run-process-images",
            stepId: "process-batch",
            token: "hook-token-1",
          }],
        },
      },
      result,
      { recordedAt: "2026-06-16T20:15:00.000Z" },
    );

    expect(metadata.workflowView).toMatchObject({
      commands: [{
        recordedAt: "2026-06-16T20:15:00.000Z",
        requestId: "platform:run-process-images:hook-token-1",
        type: "workflow.hook.resume",
      }],
      hookResponses: {
        "hook-token-1": { approved: true },
      },
      lastCommand: {
        token: "hook-token-1",
        type: "workflow.hook.resume",
      },
      submittedHookTokens: ["hook-token-1"],
    });
    expect(
      workflowViewCommandStateFromWorkflowView(metadata.workflowView).commandResults,
    ).toEqual([result]);
  });

  test("derives submitted hook tokens only from accepted hook results", () => {
    const accepted = commandResult();
    const rejected = createWorkflowViewCommandResult({
      accepted: false,
      command: {
        runId: "run-process-images",
        token: "hook-token-2",
        type: "workflow.hook.resume",
        value: { approved: false },
      },
      dispatch: { mode: "runtime" },
      error: {
        code: "WORKFLOW_UI_COMMAND_REJECTED",
        message: "Hook is already closed.",
      },
    });
    const nonHook = createWorkflowViewCommandResult({
      command: {
        actionKey: "summarize",
        runId: "run-process-images",
        type: "workflow.action.apply",
      },
      dispatch: { mode: "runtime" },
    });

    expect(
      workflowViewSubmittedHookTokensFromCommandResults([
        accepted,
        rejected,
        nonHook,
      ]),
    ).toEqual(["hook-token-1"]);
  });
});

function commandResult(): WorkflowViewCommandResult {
  return {
    accepted: true,
    command: {
      runId: "run-process-images",
      source: { surface: "watson" },
      token: "hook-token-1",
      type: "workflow.hook.resume",
      value: { approved: true },
    },
    dispatch: {
      mode: "watson-trace",
      runtimeResumed: false,
      status: "recorded",
      targetId: "run-process-images",
    },
  };
}
