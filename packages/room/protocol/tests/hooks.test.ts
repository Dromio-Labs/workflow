import { describe, expect, test } from "bun:test";
import {
  createWorkflowHookResumeCommand,
  workflowHookToJsonRenderDocument,
  type WorkflowHookRequest,
} from "../src/index.js";

describe("workflow hook protocol helpers", () => {
  test("projects approval hooks into shared JSON Render approval cards", () => {
    const hook = hookRequest({
      input: {
        imageCount: 42,
        message: "Approve processing the discovered images?",
      },
      render: {
        approveLabel: "Approve batch",
        kind: "approval",
        rejectLabel: "Hold",
      },
      title: "Approve image batch",
    });

    expect(workflowHookToJsonRenderDocument(hook)).toEqual({
      component: "ApprovalCard",
      props: {
        approveLabel: "Approve batch",
        imageCount: 42,
        question: "Approve processing the discovered images?",
        rejectLabel: "Hold",
        subtitle: "process-batch · approval",
        title: "Approve image batch",
      },
    });
  });

  test("preserves custom json-render hook documents", () => {
    const hook = hookRequest({
      render: {
        document: {
          component: "QuestionForm",
          props: {
            question: "Which image set should run next?",
          },
        },
        kind: "json-render",
      },
    });

    expect(workflowHookToJsonRenderDocument(hook)).toEqual({
      component: "QuestionForm",
      props: {
        question: "Which image set should run next?",
      },
    });
  });

  test("falls back to a JSON inspector document for non-rendered hooks", () => {
    const hook = hookRequest({
      input: {
        reason: "Needs operator review.",
      },
      render: undefined,
      title: "Review hook",
    });

    expect(workflowHookToJsonRenderDocument(hook)).toEqual({
      component: "JsonInspector",
      props: {
        title: "Review hook",
        value: {
          reason: "Needs operator review.",
        },
      },
    });
  });

  test("creates canonical hook resume commands from hook requests", () => {
    const hook = hookRequest({});

    expect(createWorkflowHookResumeCommand(hook, {
      source: {
        adapterId: "platform-preview",
        surface: "platform",
      },
      value: { approved: true },
    })).toEqual({
      runId: "run-process-images",
      source: {
        adapterId: "platform-preview",
        surface: "platform",
      },
      token: "hook-token-1",
      type: "workflow.hook.resume",
      value: { approved: true },
    });
    expect(createWorkflowHookResumeCommand({
      ...hook,
      runId: undefined,
    }, {
      value: { approved: true },
    })).toBeUndefined();
  });
});

function hookRequest(input: Partial<WorkflowHookRequest>): WorkflowHookRequest {
  return {
    id: "approval.required",
    input: {},
    runId: "run-process-images",
    stepId: "process-batch",
    token: "hook-token-1",
    ...input,
  };
}
