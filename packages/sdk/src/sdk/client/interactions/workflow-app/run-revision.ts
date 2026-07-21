import type {
  WorkflowAppRunSnapshot,
} from "./types.js";

export function isWorkflowAppRunSnapshotNewer(
  candidate: WorkflowAppRunSnapshot,
  current: WorkflowAppRunSnapshot,
): boolean {
  const candidateRevision = workflowAppRunSnapshotRevision(candidate);
  const currentRevision = workflowAppRunSnapshotRevision(current);
  if (currentRevision.terminal && !candidateRevision.terminal) return false;
  if (candidateRevision.eventIndex !== currentRevision.eventIndex) {
    return candidateRevision.eventIndex > currentRevision.eventIndex;
  }
  if (candidateRevision.eventCount !== currentRevision.eventCount) {
    return candidateRevision.eventCount > currentRevision.eventCount;
  }
  return candidateRevision.terminal && !currentRevision.terminal;
}

export function areWorkflowAppRunSnapshotsEquivalent(
  left: WorkflowAppRunSnapshot,
  right: WorkflowAppRunSnapshot,
): boolean {
  return JSON.stringify(withoutAttachedArtifactRefs(left)) ===
    JSON.stringify(withoutAttachedArtifactRefs(right));
}

export function workflowAppRunSnapshotRevision(snapshot: WorkflowAppRunSnapshot): {
  readonly eventCount: number;
  readonly eventIndex: number;
  readonly terminal: boolean;
} {
  return {
    eventCount: snapshot.events.length,
    eventIndex: snapshot.events.reduce((maximum, event) => Math.max(maximum, event.index), -1),
    terminal: ["cancelled", "completed", "failed"].includes(snapshot.status),
  };
}

function withoutAttachedArtifactRefs(snapshot: WorkflowAppRunSnapshot): WorkflowAppRunSnapshot {
  if (!snapshot.artifactRefs) return snapshot;
  const { artifactRefs: _artifactRefs, ...run } = snapshot;
  return run;
}
