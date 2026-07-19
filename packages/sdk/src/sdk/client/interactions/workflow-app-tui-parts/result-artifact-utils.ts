import { type WorkflowApp } from "../workflow-app.js";
import { type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { wrapLine } from "./config-utils.js";
import { type ResultArtifactPopupState, type TuiArtifact } from "./types.js";
import { readFileSync } from "node:fs";
import * as path from "node:path";

export function resultPopupWidth(terminalWidth: number) {
  return Math.max(40, terminalWidth);
}

export function resultPopupHeight(terminalHeight: number) {
  return Math.max(8, terminalHeight);
}

export function resultPopupContentWidth(terminalWidth: number) {
  return Math.max(24, resultPopupWidth(terminalWidth) - 7);
}

export function resultPopupVisibleRows(popup: ResultArtifactPopupState, terminalHeight: number) {
  const nonContentRows = popup.artifact?.path ? 11 : 10;
  return Math.max(1, resultPopupHeight(terminalHeight) - nonContentRows);
}

export function resultPopupWrappedLines(popup: ResultArtifactPopupState, contentWidth: number) {
  return popup.content
    .split("\n")
    .flatMap((line) => wrapLine(line || " ", contentWidth));
}

export function resultPopupMaxScrollOffset(popup: ResultArtifactPopupState, terminalWidth: number, visibleRows: number) {
  return Math.max(0, resultPopupWrappedLines(popup, resultPopupContentWidth(terminalWidth)).length - visibleRows);
}

export function resultArtifactName(app: WorkflowApp, workflowId: string) {
  return app.getWorkflow(workflowId).result?.artifactName ?? "result.md";
}

export function selectedArtifactFor(artifacts: TuiArtifact[], selectedArtifactName?: string) {
  return artifacts.find((artifact) => artifact.name === selectedArtifactName) ??
    artifacts.find((artifact) => artifact.kind === "result") ??
    artifacts[0];
}

export function artifactContent(input: {
  artifact?: TuiArtifact;
  artifactName: string;
  error: string;
  result: string;
  snapshot: WorkflowRunStoreSnapshot;
}) {
  const fileText = readArtifactText(input.artifact);
  if (fileText !== undefined) return fileText;
  if (!input.artifact || input.artifact.kind === "result") {
    return input.result || input.error || "No result artifact yet.";
  }
  if (input.artifact.kind === "trace") {
    return JSON.stringify({
      artifactName: input.artifactName,
      activity: input.snapshot.activity,
      input: input.snapshot.input,
      pendingQuestions: input.snapshot.pendingQuestions,
      result: input.result || undefined,
      runId: input.snapshot.runId,
      status: input.snapshot.status,
      steps: input.snapshot.steps,
      transcript: input.snapshot.transcript,
    }, null, 2);
  }
  return [
    input.artifact.name,
    input.artifact.path ? artifactDisplayPath(input.artifact.path) : "",
    "No inline preview is available for this artifact.",
  ].filter(Boolean).join("\n");
}

export function readArtifactText(artifact?: TuiArtifact) {
  if (!artifact?.path) return undefined;
  if (artifact.mediaType && !isTextArtifact(artifact)) return undefined;
  try {
    return readFileSync(artifact.path, "utf8");
  } catch {
    return undefined;
  }
}

export function isTextArtifact(artifact: TuiArtifact) {
  return artifact.mediaType?.startsWith("text/") ||
    artifact.mediaType === "application/json" ||
    artifact.name.endsWith(".md") ||
    artifact.name.endsWith(".json") ||
    artifact.name.endsWith(".txt");
}

export function artifactDisplayPath(filePath: string | undefined) {
  if (!filePath) return "";
  const relative = path.relative(process.cwd(), filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? `.${path.sep}${relative}`
    : filePath;
}

export function artifactDirectoryDisplay(artifacts: TuiArtifact[]) {
  const filePath = artifacts.find((artifact) => artifact.path)?.path;
  return filePath ? artifactDisplayPath(path.dirname(filePath)) : "";
}
