import { describe, expect, test } from "bun:test";
import {
  projectWorkflowFieldVisualState,
  workflowFieldLayout,
  workflowFieldModel,
} from "@dromio/workflow/client/workflow-field-svg";
import type { WorkflowRenderModel } from "@dromio/workflow/client/workflow-render";
import type { EventRecord } from "@dromio/workflow/core";

const model: WorkflowRenderModel = {
  edges: [
    { id: "initial-trigger", metadata: {}, semantic: { role: "sequence" }, source: "$initial", target: "prompt" },
    { id: "trigger-draft", metadata: {}, semantic: { role: "sequence" }, source: "prompt", target: "draft" },
    { id: "draft-done", metadata: {}, semantic: { role: "sequence" }, source: "draft", target: "done" },
  ],
  id: "review",
  label: "Review",
  loops: [],
  nodes: [
    { id: "$initial", kind: "initial", label: "Initial", metadata: {}, ports: [], semantic: { boundary: "initial", role: "boundary" } },
    { id: "prompt", kind: "trigger", label: "Prompt", metadata: {}, ports: [], semantic: { inputMode: "prompt", role: "trigger", triggerType: "manual" } },
    { id: "draft", kind: "step", label: "Draft", metadata: {}, ports: [], semantic: { role: "action" } },
    { id: "done", kind: "end", label: "Done", metadata: {}, ports: [], semantic: { outcome: "result", role: "terminal" } },
  ],
  readOnly: true,
  warnings: [],
};

describe("workflow field SVG projection", () => {
  test("projects a live step without activating unrelated triggers", () => {
    const state = projectWorkflowFieldVisualState(model, {
      events: [event("step.started", "draft")],
      status: "running",
      triggerId: "prompt",
    });

    expect(state.activeNodeId).toBe("draft");
    expect(state.statuses).toMatchObject({
      $initial: "completed",
      draft: "running",
      prompt: "completed",
    });
  });

  test("projects human waiting and completion transitions", () => {
    const waiting = projectWorkflowFieldVisualState(model, {
      events: [event("question.requested", "draft", {
        questions: [{ prompt: "Which audience should review this?" }],
      })],
      status: "waiting",
      triggerId: "prompt",
    });
    const completed = projectWorkflowFieldVisualState(model, {
      events: [event("step.completed", "draft")],
      status: "completed",
      triggerId: "prompt",
    });

    expect(waiting.phase).toBe("waiting");
    expect(waiting.waitingKind).toBe("human");
    expect(waiting.waitingLabel).toBe("Which audience should review this?");
    expect(completed.phase).toBe("completed");
    expect(completed.statuses.done).toBe("completed");
  });

  test("distinguishes automatic signal waits from human questions", () => {
    const waiting = projectWorkflowFieldVisualState(model, {
      events: [event("hook.waiting", "draft", {
        hook: { kind: "signal" },
      })],
      status: "waiting",
      triggerId: "prompt",
    });

    expect(waiting.waitingKind).toBe("signal");
    expect(waiting.phase).toBe("waiting");
  });

  test("projects real evaluation score, threshold, result, and attempt", () => {
    const evaluation = event("evaluation.completed", "draft", {
      evaluation: {
        score: 0.43,
        status: "revise",
        threshold: 0.78,
      },
    });
    evaluation.attempt = 2;

    const state = projectWorkflowFieldVisualState(model, {
      events: [evaluation],
      status: "running",
      triggerId: "prompt",
    });

    expect(state.evaluation).toEqual({
      attempt: 2,
      nodeId: "draft",
      score: 0.43,
      status: "revise",
      threshold: 0.78,
    });
  });

  test("keeps immediate child topology in the mini projection", () => {
    const nested: WorkflowRenderModel = {
      ...model,
      nodes: model.nodes.map((node) => node.id === "draft"
        ? { ...node, childWorkflow: { id: "child", label: "Child", model } }
        : node),
    };

    const compact = workflowFieldModel(nested, "mini");
    expect(compact.nodes.find((node) => node.id === "draft")?.childWorkflow?.model.nodes)
      .toHaveLength(model.nodes.length);
    expect(workflowFieldLayout(nested, "mini").width).toBeLessThan(workflowFieldLayout(nested).width);
  });

  test("renders concurrent fork branches in the mini projection", () => {
    const fork = forkModel();
    const compactFork = workflowFieldModel(fork, "mini").nodes
      .find((node) => node.id === "review-response")?.childWorkflow?.model;

    expect(compactFork?.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "assessment.assess-response",
      "noteAnalysis.analyze-note",
    ]));
    expect(compactFork?.edges.map((edge) => [edge.source, edge.target])).toEqual(expect.arrayContaining([
      ["review-response.fork:trigger", "assessment.assess-response"],
      ["review-response.fork:trigger", "noteAnalysis.analyze-note"],
    ]));
  });

  test("maps qualified fork events onto both nested branches", () => {
    const fork = forkModel();
    const assessment = childEvent("step.started", "review-response.assessment.assess-response", {
      itemId: "assessment",
      itemWorkflowStepId: "assess-response",
      parentStepId: "review-response",
    });
    const analysis = childEvent("step.started", "review-response.noteAnalysis.analyze-note", {
      itemId: "noteAnalysis",
      itemWorkflowStepId: "analyze-note",
      parentStepId: "review-response",
    });
    const running = projectWorkflowFieldVisualState(fork, {
      events: [event("fork.started", "review-response"), assessment, analysis],
      status: "running",
      triggerId: "prompt",
    });

    expect(running.activeNodeIds).toEqual(expect.arrayContaining([
      "review-response",
      "assessment.assess-response",
      "noteAnalysis.analyze-note",
    ]));
    expect(running.statuses).toMatchObject({
      "assessment.assess-response": "running",
      "noteAnalysis.analyze-note": "running",
      "review-response.fork:initial": "completed",
      "review-response.fork:trigger": "completed",
    });

    const completed = projectWorkflowFieldVisualState(fork, {
      events: [
        childEvent("step.completed", assessment.stepId!, assessment.detail),
        childEvent("step.completed", analysis.stepId!, analysis.detail),
        event("fork.completed", "review-response"),
      ],
      status: "completed",
      triggerId: "prompt",
    });
    expect(completed.statuses).toMatchObject({
      "assessment.assess-response": "completed",
      "noteAnalysis.analyze-note": "completed",
      "review-response.fork:end": "completed",
    });
  });
});

function forkModel(): WorkflowRenderModel {
  const child: WorkflowRenderModel = {
    edges: [
      { id: "entry", metadata: {}, semantic: { role: "sequence" }, source: "review-response.fork:initial", target: "review-response.fork:trigger" },
      { id: "assessment", label: "Assessment", metadata: {}, semantic: { branch: { id: "assessment", label: "Assessment" }, role: "branch" }, source: "review-response.fork:trigger", target: "assessment.assess-response" },
      { id: "analysis", label: "Analysis", metadata: {}, semantic: { branch: { id: "analysis", label: "Analysis" }, role: "branch" }, source: "review-response.fork:trigger", target: "noteAnalysis.analyze-note" },
      { id: "assessment-end", metadata: {}, semantic: { policy: "all", role: "join" }, source: "assessment.assess-response", target: "review-response.fork:end" },
      { id: "analysis-end", metadata: {}, semantic: { policy: "all", role: "join" }, source: "noteAnalysis.analyze-note", target: "review-response.fork:end" },
    ],
    id: "review-response.fork",
    label: "Fork response review",
    loops: [],
    nodes: [
      { id: "review-response.fork:initial", kind: "initial", label: "Initial", metadata: {}, ports: [], semantic: { boundary: "initial", role: "boundary" } },
      { id: "review-response.fork:trigger", kind: "trigger", label: "Fork", metadata: {}, ports: [], semantic: { branches: [{ id: "assessment", label: "Assessment" }, { id: "analysis", label: "Analysis" }], role: "fork" } },
      { id: "assessment.assess-response", kind: "step", label: "Assess response", metadata: {}, ports: [], semantic: { role: "action" } },
      { id: "noteAnalysis.analyze-note", kind: "step", label: "Analyze note", metadata: {}, ports: [], semantic: { role: "action" } },
      { id: "review-response.fork:end", kind: "end", label: "Join", metadata: {}, ports: [], semantic: { policy: "all", role: "join" } },
    ],
    readOnly: true,
    warnings: [],
  };
  return {
    ...model,
    nodes: model.nodes.map((node) => node.id === "draft"
      ? { ...node, id: "review-response", kind: "workflow", semantic: { branches: [{ id: "assessment", label: "Assessment" }, { id: "analysis", label: "Analysis" }], role: "fork" }, childWorkflow: { id: child.id, label: child.label, model: child } }
      : node),
  };
}

function event(type: string, stepId: string, detail?: EventRecord["detail"]): EventRecord {
  return {
    correlationId: `event:${type}`,
    detail,
    index: 0,
    message: type,
    runId: "run-1",
    stepId,
    timestamp: "2026-07-13T00:00:00.000Z",
    trace: {
      attributes: {},
      kind: "internal",
      name: type,
      spanId: `span:${type}`,
      status: "unset",
      traceId: "run-1",
    },
    type,
  };
}

function childEvent(type: string, stepId: string, detail: EventRecord["detail"]): EventRecord {
  return event(type, stepId, detail);
}
