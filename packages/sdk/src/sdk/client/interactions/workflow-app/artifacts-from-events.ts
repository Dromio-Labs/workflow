import { basename } from "node:path";
import type { EventRecord } from "../../../core/index.js";
import type { WorkflowAppArtifact } from "./types.js";

export function artifactsFromEvents(events: EventRecord[]): WorkflowAppArtifact[] {
  const artifacts = new Map<string, WorkflowAppArtifact>();
  for (const event of events) {
    if (event.type !== "artifact.created") continue;
    const source = artifactRecord(event.artifact) ?? artifactRecord(
      artifactRecord(event.detail)?.artifact,
    );
    if (!source) continue;
    const path = typeof source.path === "string" ? source.path : undefined;
    const name = typeof source.name === "string"
      ? source.name
      : typeof source.label === "string"
        ? source.label
        : path
          ? basename(path)
          : undefined;
    if (!name) continue;
    const artifact: WorkflowAppArtifact = {
      kind: typeof source.kind === "string" ? source.kind : "artifact",
      mediaType: typeof source.mediaType === "string" ? source.mediaType : undefined,
      name,
      path,
    };
    artifacts.set(`${artifact.kind}:${artifact.path ?? artifact.name}`, artifact);
  }
  return [...artifacts.values()];
}

function artifactRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
