import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type {
  WorkflowAppArtifact,
  WorkflowAppEndHook,
  WorkflowAppEndHookInput,
} from "./workflow-app.js";

export type CreateWorkflowAppFileArtifactHookInput = {
  directory: string;
};

export type WorkflowAppArtifactEndAdapter = {
  write(input: WorkflowAppEndHookInput): Promise<WorkflowAppArtifact[] | void> | WorkflowAppArtifact[] | void;
};

export type WorkflowAppArtifactEndAdapterLike =
  | WorkflowAppArtifactEndAdapter
  | WorkflowAppEndHook;

export type ArtifactEndInput =
  | WorkflowAppArtifactEndAdapterLike
  | { adapter: WorkflowAppArtifactEndAdapterLike };

function createArtifactEnd(input: ArtifactEndInput): WorkflowAppEndHook {
  const adapter = typeof input === "function" || "write" in input ? input : input.adapter;
  return async (hookInput) => {
    if (typeof adapter === "function") return adapter(hookInput);
    return adapter.write(hookInput);
  };
}

export const artifactEnd = Object.assign(createArtifactEnd, {
  file: fileArtifactEnd,
});

export function fileArtifactEnd(
  input: CreateWorkflowAppFileArtifactHookInput,
): WorkflowAppEndHook {
  return artifactEnd(fileArtifactEndAdapter(input));
}

export const createWorkflowAppFileArtifactHook = fileArtifactEnd;

export function fileArtifactEndAdapter(
  input: CreateWorkflowAppFileArtifactHookInput,
): WorkflowAppArtifactEndAdapter {
  return {
    async write({ artifactName, run }) {
      const root = path.resolve(input.directory, safePathSegment(run.runId));
      await mkdir(root, { recursive: true });
      const artifacts: WorkflowAppArtifact[] = [];

      if (run.status === "completed" && run.result !== undefined) {
        const resultPath = path.join(root, safeArtifactRelativePath(artifactName));
        await mkdir(path.dirname(resultPath), { recursive: true });
        await writeFile(resultPath, run.result, "utf8");
        artifacts.push({
          kind: "result",
          mediaType: mediaTypeForArtifactName(artifactName),
          name: artifactName,
          path: resultPath,
        });
      }

      const tracePath = path.join(root, "trace.json");
      await writeFile(tracePath, JSON.stringify({
        answers: run.answers,
        artifactName,
        events: run.events,
        input: run.input,
        pendingHooks: run.pendingHooks,
        pendingQuestions: run.pendingQuestions,
        result: run.result,
        runId: run.runId,
        state: run.state,
        status: run.status,
        workflowId: run.workflowId,
      }, null, 2), "utf8");
      artifacts.push({
        kind: "trace",
        mediaType: "application/json",
        name: "trace.json",
        path: tracePath,
      });

      return artifacts;
    },
  };
}

function mediaTypeForArtifactName(name: string) {
  if (name.endsWith(".md")) return "text/markdown";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

function safeArtifactRelativePath(value: string) {
  const parts = value.split(/[\\/]+/).map(safePathSegment).filter(Boolean);
  return parts.length > 0 ? path.join(...parts) : "result.md";
}

function safePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+$/, "_").slice(0, 80) || "_";
}
