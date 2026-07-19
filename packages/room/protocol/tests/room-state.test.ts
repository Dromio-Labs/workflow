import { describe, expect, test } from "bun:test";
import {
  createWorkflowViewCommandResult,
  workflowHookRequestsFromRoomHandRaises,
  workflowViewCommandResultsFromRoomSnapshot,
  workflowViewCommandResultsFromRunLinks,
  workflowViewLiveStateFromWorkflowView,
  workflowViewPendingHooksFromRoomSnapshot,
  workflowViewPendingHooksFromWorkflowView,
  workflowViewSnapshotWithLiveState,
  processImagesViewSnapshot,
  type WorkflowRoomSnapshot,
  type WorkflowViewCommandResult,
} from "../src/index.js";

describe("workflow room command state helpers", () => {
  test("reads command results from room metadata before linked workflow runs", () => {
    const roomResult = commandResult("room-run", "room-token");
    const runResult = commandResult("linked-run", "linked-token");
    const room = roomSnapshot({
      metadata: {
        workflowCommandResults: [roomResult],
      },
      workflowRuns: [{
        id: "linked-run-1",
        metadata: {
          workflowView: {
            commandResults: [runResult],
          },
        },
        status: "waiting",
        workflowId: "process-images",
      }],
    });

    expect(workflowViewCommandResultsFromRoomSnapshot(room)).toEqual([roomResult]);
  });

  test("reads command results from linked workflow run metadata", () => {
    const runResult = commandResult("linked-run", "linked-token");
    const invalidResult = {
      accepted: true,
      command: { type: "workflow.hook.resume" },
    };
    const runs = [{
      id: "linked-run-1",
      metadata: {
        workflowView: {
          commandResults: [invalidResult, runResult],
        },
      },
      status: "waiting",
      workflowId: "process-images",
    }];

    expect(workflowViewCommandResultsFromRunLinks(runs)).toEqual([runResult]);
    expect(workflowViewCommandResultsFromRoomSnapshot(roomSnapshot({
      workflowRuns: runs,
    }))).toEqual([runResult]);
  });

  test("reads open pending hooks from workflow view state", () => {
    expect(workflowViewPendingHooksFromWorkflowView({
      pendingHooks: [
        {
          id: "resolved-hook",
          input: {},
          runId: "linked-run",
          stepId: "review",
          token: "resolved-token",
        },
        {
          id: "open-hook",
          input: {
            question: "Approve the batch?",
          },
          render: {
            approveLabel: "Approve",
            kind: "approval",
            rejectLabel: "Hold",
          },
          runId: "linked-run",
          stepId: "review",
          title: "Approve batch",
          token: "open-token",
        },
        {
          id: "invalid-hook",
          input: undefined,
          stepId: "review",
          token: "invalid-token",
        },
      ],
      submittedHookTokens: ["resolved-token"],
    })).toEqual([
      {
        id: "open-hook",
        input: {
          question: "Approve the batch?",
        },
        render: {
          approveLabel: "Approve",
          kind: "approval",
          rejectLabel: "Hold",
        },
        runId: "linked-run",
        stepId: "review",
        title: "Approve batch",
        token: "open-token",
      },
    ]);
  });

  test("reads pending hooks from linked room workflow runs", () => {
    expect(workflowViewPendingHooksFromRoomSnapshot(roomSnapshot({
      workflowRuns: [{
        id: "linked-run-1",
        metadata: {
          workflowView: {
            commandResults: [commandResult("linked-run", "resolved-token")],
            pendingHooks: [
              {
                id: "resolved-hook",
                input: {},
                runId: "linked-run",
                stepId: "review",
                token: "resolved-token",
              },
              {
                id: "open-hook",
                input: {},
                runId: "linked-run",
                stepId: "review",
                token: "open-token",
              },
            ],
          },
        },
        status: "waiting",
        workflowId: "process-images",
      }],
    }))).toEqual([
      {
        id: "open-hook",
        input: {},
        runId: "linked-run",
        stepId: "review",
        token: "open-token",
      },
    ]);
  });

  test("projects open room hand raises into workflow hook requests", () => {
    expect(workflowHookRequestsFromRoomHandRaises([
      {
        id: "approval-1",
        metadata: {
          runId: "run-1",
          stepId: "review",
        },
        priority: "high",
        question: "Approve this batch?",
        reason: "approval",
        status: "open",
      },
      {
        id: "resolved-1",
        question: "Already answered?",
        status: "resolved",
      },
    ], {
      fallbackRunId: "fallback-run",
      fallbackWorkflowId: "process-images",
      idPrefix: "watson.",
      tokenPrefix: "watson:",
    })).toEqual([{
      id: "watson.approval-1",
      input: {
        priority: "high",
        question: "Approve this batch?",
        reason: "approval",
      },
      kind: "approval",
      render: {
        approveLabel: "Approve",
        kind: "approval",
        rejectLabel: "Hold",
      },
      runId: "run-1",
      stepId: "review",
      title: "Approve this batch?",
      token: "watson:approval-1",
    }]);
  });

  test("projects live workflow view state for adapter surfaces", () => {
    const result = commandResult("linked-run", "resolved-token");

    expect(workflowViewLiveStateFromWorkflowView({
      commandResults: [result],
      pendingHooks: [
        {
          id: "resolved-hook",
          input: {},
          runId: "linked-run",
          stepId: "review",
          token: "resolved-token",
        },
        {
          id: "open-hook",
          input: {
            question: "Approve the batch?",
          },
          runId: "linked-run",
          stepId: "review",
          token: "open-token",
        },
      ],
      result: {
        component: "ImageBatchSummary",
        props: {
          imageCount: 42,
          pendingApproval: false,
        },
      },
    }, {
      resultTitle: "Batch summary",
    })).toEqual({
      commandResults: [result],
      pendingHooks: [{
        id: "open-hook",
        input: {
          question: "Approve the batch?",
        },
        runId: "linked-run",
        stepId: "review",
        token: "open-token",
      }],
      result: {
        document: {
          component: "ImageBatchSummary",
          props: {
            imageCount: 42,
            pendingApproval: false,
          },
        },
        kind: "json-render",
        title: "Batch summary",
      },
    });
  });

  test("applies live workflow view state to an existing snapshot", () => {
    const result = commandResult("linked-run", "resolved-token");
    const liveState = {
      commandResults: [result],
      pendingHooks: [{
        id: "open-hook",
        input: {},
        runId: "linked-run",
        stepId: "review",
        token: "open-token",
      }],
      result: {
        document: {
          component: "ImageBatchSummary",
          props: {
            imageCount: 42,
            pendingApproval: false,
          },
        },
        kind: "json-render" as const,
        title: "Batch summary",
      },
    };

    expect(workflowViewSnapshotWithLiveState(
      processImagesViewSnapshot,
      liveState,
    )).toMatchObject({
      commandResults: [result],
      pendingHooks: [{
        id: "open-hook",
        token: "open-token",
      }],
      render: {
        id: "process-images",
      },
      result: {
        kind: "json-render",
        title: "Batch summary",
      },
      version: "workflow-view/v1",
    });

    const clearedSnapshot = workflowViewSnapshotWithLiveState({
      ...processImagesViewSnapshot,
      commandResults: [commandResult("stale-run", "stale-token")],
      pendingHooks: [{
        id: "stale-hook",
        input: {},
        stepId: "review",
        token: "stale-token",
      }],
      result: {
        kind: "markdown",
        value: "stale result",
      },
    }, {
      commandResults: [],
      pendingHooks: [],
    });

    expect(clearedSnapshot).toMatchObject({
      commandResults: [],
      pendingHooks: [],
      render: {
        id: "process-images",
      },
    });
    expect(clearedSnapshot?.result).toBeUndefined();
    expect(workflowViewSnapshotWithLiveState(undefined, liveState)).toBeUndefined();
  });
});

function commandResult(
  runId: string,
  token: string,
): WorkflowViewCommandResult {
  return createWorkflowViewCommandResult({
    command: {
      runId,
      token,
      type: "workflow.hook.resume",
      value: { approved: true },
    },
    dispatch: {
      mode: "watson-trace",
    },
  });
}

function roomSnapshot(
  input: Partial<WorkflowRoomSnapshot> = {},
): WorkflowRoomSnapshot {
  return {
    artifacts: [],
    decisions: [],
    events: [],
    handRaises: [],
    id: "room-1",
    kind: "watson",
    messages: [],
    metadata: {},
    participants: [],
    status: "active",
    workflowRuns: [],
    ...input,
  };
}
