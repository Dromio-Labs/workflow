import type {
  WorkflowAppRunSnapshot,
} from "./types.js";

export function isWorkflowAppRunSnapshotNewer(
  candidate: WorkflowAppRunSnapshot,
  current: WorkflowAppRunSnapshot,
): boolean {
  const candidateRevision = lastEventIndex(candidate);
  const currentRevision = lastEventIndex(current);
  if (candidateRevision !== currentRevision) return candidateRevision > currentRevision;
  return candidate.events.length > current.events.length;
}

function lastEventIndex(snapshot: WorkflowAppRunSnapshot): number {
  return snapshot.events.reduce((maximum, event) => Math.max(maximum, event.index), -1);
}
