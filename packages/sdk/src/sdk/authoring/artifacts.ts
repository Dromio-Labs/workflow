import type { EventPayload, StepRuntimeMetadata } from "../core/index.js";

export type StepFileArtifactInput = {
  id?: string;
  label?: string;
  mediaType: string;
  metadata?: Record<string, boolean | number | string>;
  path: string;
};

export type StepFileArtifact = StepFileArtifactInput & {
  id: string;
  kind: "file";
};

export type StepArtifactRegistry = {
  file(input: StepFileArtifactInput): StepFileArtifact;
};

export function createStepArtifactRegistry(input: {
  emit(event: EventPayload): void;
  step: StepRuntimeMetadata;
}): StepArtifactRegistry {
  let artifactIndex = 0;
  return {
    file(file) {
      artifactIndex += 1;
      const artifact: StepFileArtifact = {
        ...file,
        id: file.id ?? `${input.step.runId}:${input.step.id}:artifact:${artifactIndex}`,
        kind: "file",
      };
      input.emit({
        artifact,
        message: file.label ?? `Created ${file.path}.`,
        stepId: input.step.id,
        type: "artifact.created",
      });
      return artifact;
    },
  };
}
