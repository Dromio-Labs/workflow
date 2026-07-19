import { type WorkflowTuiTriggerBoundarySummary } from "../workflow-app-tui.js";
import { type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { stepPromptDetailRows, stepRelatedFileRows } from "./activity-table.js";
import { displayText, type WorkflowMetadataSelectionRow, type WorkflowOverviewRow, type WorkflowStepRelatedFileRow } from "./artifact-step-pages.js";
import { wrappedValueLines } from "./config-utils.js";
import { artifactDisplayPath } from "./dialogs-popups.js";
import { publishedInputExampleLines, triggerInputExampleLines } from "./input-form.js";
import { metadataLinesEqual, visibleMetadataLineCount } from "./metadata-sections.js";
import { truncate } from "./string-format.js";
import { THEME } from "./style.js";
import { type TuiWorkspaceFrame } from "./types.js";
import { type WorkflowDesignNode } from "./workflow-design.js";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";

export function workflowOverviewRows(
  workflow: WorkflowAppWorkflowDescriptor,
  selectedStep: WorkflowDesignNode | undefined,
  selectedTriggerSummary: WorkflowTuiTriggerBoundarySummary | undefined,
  workspaceFrame: TuiWorkspaceFrame | undefined,
): WorkflowOverviewRow[] {
  const rows: WorkflowOverviewRow[] = [
    { label: "title", value: workflow.title },
  ];
  for (const [index, line] of wrappedValueLines(workflow.description ?? "-", 72, 3).entries()) {
    rows.push({
      fg: THEME.text,
      label: index === 0 ? "description" : "",
      value: line,
    });
  }
  if (selectedTriggerSummary) {
    rows.push({
      label: "trigger",
      value: `${selectedTriggerSummary.boundaryId} · ${selectedTriggerSummary.boundaryType}`,
    });
  } else if (selectedStep?.triggerType) {
    rows.push({
      label: "trigger",
      value: `${selectedStep.id} · ${selectedStep.triggerType}`,
    });
  }
  rows.push({ label: "workflow id", value: workflow.id });
  const documentId = workspaceFrame?.parsedDocument?.id;
  if (documentId && documentId !== workflow.id) {
    rows.push({ label: "document id", value: documentId });
  }
  if (selectedStep?.description) {
    for (const [index, line] of wrappedValueLines(selectedStep.description, 72, 2).entries()) {
      rows.push({
        fg: THEME.text,
        label: index === 0 ? "trigger detail" : "",
        value: line,
      });
    }
  }
  return rows;
}

export function workflowRelatedFileRows(
  workflow: WorkflowAppWorkflowDescriptor,
  workspaceFrame: TuiWorkspaceFrame | undefined,
): WorkflowStepRelatedFileRow[] {
  const rows: WorkflowStepRelatedFileRow[] = [];
  const seen = new Set<string>();
  const add = (role: string, filePath: string | undefined) => {
    if (!filePath) return;
    const resolved = resolveSourcePath(filePath);
    if (!existsSync(resolved) || !statSync(resolved).isFile()) return;
    const key = path.resolve(resolved);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      directory: artifactDisplayPath(path.dirname(resolved)),
      file: path.basename(resolved),
      path: resolved,
      role,
    });
  };
  const workflowDocumentPath = findWorkflowDocumentPath(workflow, workspaceFrame);
  add("document", workflowDocumentPath);
  const workflowDirectory = path.resolve(process.cwd(), "workflows", workflow.id);
  if (existsSync(workflowDirectory) && statSync(workflowDirectory).isDirectory()) {
    for (const filePath of listWorkflowDirectoryFiles(workflowDirectory)) {
      add(workflowRelatedFileRole(filePath), filePath);
    }
  }
  add("config", workflow.configuration?.configPath);
  add("app", path.resolve(process.cwd(), "src/app.ts"));
  return rows.sort(compareWorkflowRelatedFiles);
}

export function findWorkflowDocumentPath(
  workflow: WorkflowAppWorkflowDescriptor,
  workspaceFrame: TuiWorkspaceFrame | undefined,
) {
  const workflowDirectory = path.resolve(process.cwd(), ".dromio/workflows");
  const directPath = path.join(workflowDirectory, `${workflow.id}.workflow.json`);
  if (existsSync(directPath)) return directPath;
  if (!existsSync(workflowDirectory) || !statSync(workflowDirectory).isDirectory()) return undefined;
  const documentId = workspaceFrame?.parsedDocument?.id;
  try {
    for (const entry of readdirSync(workflowDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".workflow.json")) continue;
      const filePath = path.join(workflowDirectory, entry.name);
      const id = workflowDocumentFileId(filePath);
      if (id === documentId || id === workflow.id) return filePath;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function workflowDocumentFileId(filePath: string) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

export function listWorkflowDirectoryFiles(directory: string) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(directory, entry.name))
      .sort(compareWorkflowRelatedFiles);
  } catch {
    return [];
  }
}

export function compareWorkflowRelatedFiles(left: string | WorkflowStepRelatedFileRow, right: string | WorkflowStepRelatedFileRow) {
  const leftPath = typeof left === "string" ? left : left.path;
  const rightPath = typeof right === "string" ? right : right.path;
  const leftRank = workflowRelatedFileRank(path.basename(leftPath), typeof left === "string" ? undefined : left.role);
  const rightRank = workflowRelatedFileRank(path.basename(rightPath), typeof right === "string" ? undefined : right.role);
  return leftRank - rightRank || path.basename(leftPath).localeCompare(path.basename(rightPath));
}

export function workflowRelatedFileRank(fileName: string, role?: string) {
  if (role === "document") return 0;
  if (role === "view") return 1;
  if (fileName === "metadata.ts" || fileName === "metadata.tsx") return 2;
  if (fileName === "workflow.ts" || fileName === "workflow.tsx") return 3;
  if (role === "config" || fileName === "config.json") return 4;
  if (fileName === "config.ts" || fileName === "config.tsx") return 5;
  if (fileName === "model-router.ts" || fileName === "model-router.tsx") return 6;
  if (fileName === "result.ts" || fileName === "result.tsx") return 7;
  if (role === "app") return 20;
  return 10;
}

export function workflowRelatedFileRole(filePath: string) {
  const fileName = path.basename(filePath);
  if (fileName === "metadata.ts" || fileName === "metadata.tsx") return "metadata";
  if (fileName === "workflow.ts" || fileName === "workflow.tsx") return "glue";
  if (fileName === "config.json") return "config";
  if (fileName === "config.ts" || fileName === "config.tsx") return "config";
  if (fileName === "model-router.ts" || fileName === "model-router.tsx") return "model";
  if (fileName === "result.ts" || fileName === "result.tsx") return "result";
  return "related";
}

export function stepCatalogDirectory(step: WorkflowDesignNode) {
  const implementationSource = step.catalog?.implementation?.source;
  if (implementationSource) {
    const resolved = resolveSourcePath(implementationSource);
    return existsSync(resolved) && statSync(resolved).isDirectory()
      ? resolved
      : path.dirname(resolved);
  }
  const catalogId = step.catalogItemId ?? step.catalog?.id;
  if (!catalogId) return undefined;
  const [domain, ...rest] = catalogId.split(".");
  if (!domain || rest.length === 0) return undefined;
  return path.resolve(process.cwd(), "catalog", domain, rest.join("-"));
}

export function resolveSourcePath(source: string) {
  const resolved = path.isAbsolute(source) ? source : path.resolve(process.cwd(), source);
  if (existsSync(resolved)) return resolved;
  for (const extension of [".ts", ".tsx", ".js", ".json", ".md"]) {
    const withExtension = `${resolved}${extension}`;
    if (existsSync(withExtension)) return withExtension;
  }
  return resolved;
}

export function listStepRelatedFiles(directory: string) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(directory, entry.name))
      .filter((filePath) => stepRelatedFileRole(filePath) !== "prompt")
      .sort(compareStepRelatedFiles);
  } catch {
    return [];
  }
}

export function compareStepRelatedFiles(left: string, right: string) {
  const leftRank = stepRelatedFileRank(path.basename(left));
  const rightRank = stepRelatedFileRank(path.basename(right));
  return leftRank - rightRank || path.basename(left).localeCompare(path.basename(right));
}

export function stepRelatedFileRank(fileName: string) {
  if (fileName === "step.ts" || fileName === "step.tsx") return 0;
  if (fileName === "index.ts" || fileName === "index.tsx") return 2;
  if (fileName === "schema.ts" || fileName === "schema.tsx") return 3;
  if (fileName === "score-policy.ts" || fileName === "score-policy.tsx") return 4;
  return 10;
}

export function stepRelatedFileRole(filePath: string, implementationPath?: string) {
  const fileName = path.basename(filePath);
  if (implementationPath && path.resolve(filePath) === path.resolve(implementationPath)) return "step";
  if (fileName === "index.ts" || fileName === "index.tsx") return "exports";
  if (fileName === "schema.ts" || fileName === "schema.tsx") return "schema";
  if (fileName === "score-policy.ts" || fileName === "score-policy.tsx") return "scoring";
  if (fileName.endsWith(".md")) return "prompt";
  if (fileName.endsWith(".json")) return "config";
  return "related";
}

export function stepFileRoleColor(role: string) {
  if (role === "step") return THEME.accent;
  if (role === "scoring") return THEME.warning;
  if (role === "document") return THEME.accent;
  if (role === "view") return THEME.info;
  if (role === "glue") return THEME.warning;
  if (role === "config") return THEME.info;
  if (role === "app") return THEME.success;
  return THEME.text;
}

export function metadataSelectionRows(input: {
  inputDraft: string;
  selectedStep?: WorkflowDesignNode;
  selectedTriggerSummary?: WorkflowTuiTriggerBoundarySummary;
  workspaceFrame?: TuiWorkspaceFrame;
  workflow: WorkflowAppWorkflowDescriptor;
}): WorkflowMetadataSelectionRow[] {
  const rows: WorkflowMetadataSelectionRow[] = [];
  if (input.selectedStep?.boundary === "trigger") {
    for (const _row of workflowOverviewRows(
      input.workflow,
      input.selectedStep,
      input.selectedTriggerSummary,
      input.workspaceFrame,
    )) {
      rows.push({ kind: "line" });
    }
    for (const row of workflowRelatedFileRows(input.workflow, input.workspaceFrame)) {
      rows.push({ kind: "file", path: row.path });
    }
  }
  for (const row of stepPromptDetailRows(input.selectedStep ?? {})) {
    rows.push({
      kind: "file",
      path: row.path,
    });
  }
  for (const row of stepRelatedFileRows(input.selectedStep)) {
    rows.push({ kind: "file", path: row.path });
  }
  for (const field of input.workflow.configuration?.fields ?? []) {
    rows.push({ field, kind: "config" });
  }
  if (input.workspaceFrame) {
    for (let index = 0; index < 6; index += 1) rows.push({ kind: "line" });
  }
  if (input.selectedTriggerSummary) {
    const inputLines = triggerInputExampleLines(input.workflow, input.selectedTriggerSummary);
    for (let index = 0; index < visibleMetadataLineCount(inputLines); index += 1) {
      rows.push({ kind: "line" });
    }
    for (let index = 0; index < 5; index += 1) rows.push({ kind: "line" });
    const httpBodyLines = publishedInputExampleLines(input.selectedTriggerSummary);
    if (
      input.selectedTriggerSummary.publishedTrigger &&
      !metadataLinesEqual(inputLines, httpBodyLines)
    ) {
      for (let index = 0; index < visibleMetadataLineCount(httpBodyLines); index += 1) {
        rows.push({ kind: "line" });
      }
    }
  }
  return rows;
}

export type StepPromptView =
  | {
      kind: "file";
      path: string;
    }
  | {
      kind: "loader";
    }
  | {
      kind: "text";
      preview: string;
    };

export function formatStepPrompt(prompt: StepPromptView) {
  if (prompt.kind === "file") {
    const displayPath = artifactDisplayPath(prompt.path);
    const fileName = path.basename(prompt.path);
    return fileName && fileName !== displayPath ? `${fileName} · ${displayPath}` : displayPath;
  }
  if (prompt.kind === "text") return `inline · ${truncate(prompt.preview.replace(/\s+/g, " "), 72)}`;
  return "loader";
}

export function formatStepPromptDirectory(prompt: StepPromptView) {
  if (prompt.kind !== "file") return "";
  return artifactDisplayPath(path.dirname(prompt.path));
}

export function formatStepPromptRole(model: { label?: string; operation: string }) {
  if (isGuardrailOperation(model)) return "guardrail";
  const operation = displayText(model.operation).trim();
  return operation || "prompt";
}

export function promptRoleColor(role: string) {
  return role === "guardrail" ? THEME.warning : THEME.info;
}

export function isGuardrailOperation(model: { label?: string; operation: string }) {
  const operation = model.operation.toLowerCase();
  const label = (model.label ?? "").toLowerCase();
  return operation === "evaluate" ||
    operation === "score" ||
    operation.endsWith(".evaluate") ||
    operation.endsWith("-evaluate") ||
    operation.includes("guardrail") ||
    label.includes("evaluate") ||
    label.includes("score") ||
    label.includes("guardrail");
}

export function formatModelRef(model: { id: string; label?: string; model?: string; worker?: string }) {
  const label = model.label ?? model.id;
  return model.model ? `${label} (${model.worker ?? "worker"}/${model.model})` : label;
}
