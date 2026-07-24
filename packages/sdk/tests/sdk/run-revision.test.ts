import { describe, expect, test } from "bun:test";

import {
  areWorkflowAppRunSnapshotsEquivalent,
  isWorkflowAppRunSnapshotNewer,
} from "../../src/sdk/client/interactions/workflow-app/run-revision.js";
import type { WorkflowAppRunSnapshot } from "../../src/sdk/client/interactions/workflow-app/types.js";

describe("workflow run snapshot revisions", () => {
  test("compares JSON structure independently of object key insertion order", () => {
    const first = snapshot({
      state: { alpha: 1, nested: { left: true, right: false } },
    });
    const reordered = {
      workflowId: first.workflowId,
      status: first.status,
      state: { nested: { right: false, left: true }, alpha: 1 },
      runId: first.runId,
      pendingQuestions: first.pendingQuestions,
      input: first.input,
      events: first.events,
      artifacts: first.artifacts,
    } as WorkflowAppRunSnapshot;

    expect(areWorkflowAppRunSnapshotsEquivalent(first, reordered)).toBe(true);
    expect(areWorkflowAppRunSnapshotsEquivalent(first, {
      ...reordered,
      state: { alpha: 2, nested: { left: true, right: false } },
    })).toBe(false);
  });

  test("ignores attached artifact references but preserves terminal revision ordering", () => {
    const active = snapshot();
    const withArtifactRefs = {
      ...active,
      artifactRefs: [{ artifactId: "artifact-a", kind: "report", uri: "artifact:artifact-a" }],
    };
    expect(areWorkflowAppRunSnapshotsEquivalent(active, withArtifactRefs)).toBe(true);
    expect(isWorkflowAppRunSnapshotNewer({ ...active, status: "completed" }, active)).toBe(true);
    expect(isWorkflowAppRunSnapshotNewer(active, { ...active, status: "completed" })).toBe(false);
  });
});

function snapshot(overrides: Partial<WorkflowAppRunSnapshot> = {}): WorkflowAppRunSnapshot {
  return {
    artifacts: [],
    events: [],
    input: "{}",
    pendingQuestions: [],
    runId: "run-revision",
    status: "waiting",
    workflowId: "revision-proof",
    ...overrides,
  };
}
