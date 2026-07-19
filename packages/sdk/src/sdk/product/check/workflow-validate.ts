import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  projectWorkflowDocumentRenderModel,
  validateWorkflowRenderability,
} from "../../client/workflow-render/index.js";
import {
  workflowDocumentSchema,
  type WorkflowDocument,
} from "../workflow-document/index.js";
import {
  loadWorkbenchCatalog,
  resolveCatalogSource,
} from "./workflow-validate-catalog.js";
import {
  dedupeErrors,
  relativeLocation,
  resultFor,
  validateError,
} from "./workflow-validate-issue.js";
import type {
  DromioValidateInput,
  ValidateError,
  ValidateOutput,
  WorkflowValidateResult,
} from "./workflow-validate-types.js";
import {
  workbenchName,
  workflowFilesForInput,
} from "./workflow-workbench-files.js";

type RawWorkflowDocument = {
  edges?: { id?: unknown; source?: unknown; target?: unknown }[];
  end?: { id?: unknown };
  id?: unknown;
  nodes?: { catalogItemId?: unknown; id?: unknown }[];
  trigger?: { id?: unknown };
};

const INFRA_PATTERNS = [
  "fetch(",
  "db.query",
  "db.insert",
  "openai.",
  "anthropic.",
  "fs.read(",
  "fs.readFile",
  "fs.write(",
  "fs.writeFile",
  "from \"openai\"",
  "from 'openai'",
  "from \"@anthropic-ai",
  "from '@anthropic-ai",
];

export async function validateDromioWorkbench(input: DromioValidateInput = {}): Promise<ValidateOutput> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const renderOnly = input.mode === "render-only";
  const workflowFiles = await workflowFilesForInput({ cwd, workflowId: input.workflowId });
  const catalog = await loadWorkbenchCatalog(cwd);
  const resultsById = new Map<string, WorkflowValidateResult>();
  const workflowIds = new Set<string>();

  for (const filePath of workflowFiles) {
    const result = await validateWorkflowFile({ catalog, cwd, filePath, renderOnly });
    workflowIds.add(result.id);
    resultsById.set(result.id, result);
  }

  if (!renderOnly) {
    for (const glueResult of await validateGlueFolders({
      cwd,
      includeOrphans: !input.workflowId,
      workflowIds,
    })) {
      const existing = resultsById.get(glueResult.id);
      if (existing) {
        existing.errors.push(...glueResult.errors);
        existing.valid = !existing.errors.some((error) => error.severity === "error");
      } else {
        resultsById.set(glueResult.id, glueResult);
      }
    }
  }
  const results = [...resultsById.values()];
  results.sort((left, right) => left.id.localeCompare(right.id));
  const errorCount = results.reduce(
    (total, result) => total + result.errors.filter((error) => error.severity === "error").length,
    0,
  );
  const failed = results.filter((result) => result.errors.some((error) => error.severity === "error")).length;
  const passed = results.length - failed;
  return {
    summary: {
      errorCount,
      failed,
      passed,
      total: results.length,
    },
    valid: errorCount === 0,
    workbench: await workbenchName(cwd),
    workflows: results,
  };
}

export function formatValidateOutput(output: ValidateOutput): string {
  if (output.valid) {
    return `dromio validate passed: ${output.summary.passed} workflow${output.summary.passed === 1 ? "" : "s"} valid, ${output.summary.errorCount} errors`;
  }
  const lines = [
    `dromio validate failed: ${output.summary.failed} workflow${output.summary.failed === 1 ? "" : "s"} failed, ${output.summary.errorCount} errors`,
  ];
  for (const workflow of output.workflows) {
    const errors = workflow.errors.filter((error) => error.severity === "error");
    if (errors.length === 0) continue;
    lines.push(`\n${workflow.id}`);
    for (const error of errors) {
      lines.push(`  ${error.code} ${error.location}: ${error.message}`);
    }
  }
  return lines.join("\n");
}

async function validateWorkflowFile(input: {
  catalog: Awaited<ReturnType<typeof loadWorkbenchCatalog>>;
  cwd: string;
  filePath: string;
  renderOnly: boolean;
}): Promise<WorkflowValidateResult> {
  const rawText = await readFile(input.filePath, "utf8");
  const location = relativeLocation(input.cwd, input.filePath);
  const errors: ValidateError[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    return resultFor(input.cwd, input.filePath, {
      errors: [validateError({
        code: "MISSING_WORKFLOW_ID",
        location,
        message: error instanceof Error ? `Workflow JSON could not be parsed: ${error.message}` : "Workflow JSON could not be parsed.",
      })],
      parsed: undefined,
    });
  }

  const raw = parsed as RawWorkflowDocument;
  if (typeof raw.id !== "string" || raw.id.trim().length === 0) {
    errors.push(validateError({
      code: "MISSING_WORKFLOW_ID",
      location,
      message: "Workflow document has no id field.",
    }));
  }
  if (!raw.trigger) {
    errors.push(validateError({
      code: "MISSING_TRIGGER",
      location,
      message: "Workflow document has no trigger.",
    }));
  }
  if (!raw.end) {
    errors.push(validateError({
      code: "MISSING_END",
      location,
      message: "Workflow document has no end.",
    }));
  }

  const schemaResult = workflowDocumentSchema.safeParse(parsed);
  if (schemaResult.success) {
    errors.push(...validateTypedWorkflow({
      catalog: input.catalog,
      cwd: input.cwd,
      document: schemaResult.data,
      filePath: input.filePath,
      renderOnly: input.renderOnly,
      rawText,
    }));
  } else {
    errors.push(...validateRawGraph({ cwd: input.cwd, filePath: input.filePath, raw }));
    errors.push(...validateInfraStrings(input.cwd, input.filePath, rawText, parsed));
  }

  return resultFor(input.cwd, input.filePath, { errors, parsed });
}

function validateTypedWorkflow(input: {
  catalog: Awaited<ReturnType<typeof loadWorkbenchCatalog>>;
  cwd: string;
  document: WorkflowDocument;
  filePath: string;
  renderOnly: boolean;
  rawText: string;
}): ValidateError[] {
  if (input.renderOnly) {
    return validateRenderableWorkflow(input);
  }
  const errors = [
    ...validateRawGraph({ cwd: input.cwd, filePath: input.filePath, raw: input.document }),
    ...validateCatalogReferences(input),
    ...validateRenderableWorkflow(input),
    ...validateInfraStrings(input.cwd, input.filePath, input.rawText, input.document),
    ...validateGlueForWorkflow(input.cwd, input.document.id),
  ];
  const fileId = path.basename(input.filePath, ".workflow.json");
  if (fileId !== input.document.id) {
    errors.push(validateError({
      code: "GLUE_FOLDER_MISMATCH",
      details: { documentId: input.document.id, fileId },
      location: relativeLocation(input.cwd, input.filePath),
      message: `Workflow document id ${input.document.id} must match file name ${fileId}.`,
    }));
  }
  return errors;
}

function validateRawGraph(input: {
  cwd: string;
  filePath: string;
  raw: RawWorkflowDocument;
}): ValidateError[] {
  const location = relativeLocation(input.cwd, input.filePath);
  const errors: ValidateError[] = [];
  const triggerId = typeof input.raw.trigger?.id === "string" ? input.raw.trigger.id : "trigger";
  const endId = typeof input.raw.end?.id === "string" ? input.raw.end.id : "end";
  const nodeIds = new Set(rawNodes(input.raw).map((node) => node.id));
  const allIds = new Set([triggerId, endId, ...nodeIds]);
  const edges = rawEdges(input.raw);

  for (const edge of edges) {
    if (!allIds.has(edge.source) || !allIds.has(edge.target)) {
      errors.push(validateError({
        code: "ORPHAN_EDGE",
        details: { edgeId: edge.id, source: edge.source, target: edge.target },
        location,
        message: `Edge ${edge.id} references a node that does not exist.`,
      }));
    }
  }

  const reachable = reachableIds(triggerId, edges);
  for (const nodeId of nodeIds) {
    if (!reachable.has(nodeId)) {
      errors.push(validateError({
        code: "UNREACHABLE_NODE",
        details: { nodeId },
        location,
        message: `Node ${nodeId} is not reachable from trigger.`,
      }));
    }
  }
  if (!reachable.has(endId)) {
    errors.push(validateError({
      code: "END_UNREACHABLE",
      details: { endId },
      location,
      message: `End ${endId} is not reachable from trigger.`,
    }));
  }
  return errors;
}

function validateCatalogReferences(input: {
  catalog: Awaited<ReturnType<typeof loadWorkbenchCatalog>>;
  cwd: string;
  document: WorkflowDocument;
  filePath: string;
}): ValidateError[] {
  const errors: ValidateError[] = [];
  for (const node of input.document.nodes) {
    if (!input.catalog.ids.has(node.catalogItemId)) {
      errors.push(validateError({
        code: "UNRESOLVED_CATALOG_ITEM",
        details: { catalogItemId: node.catalogItemId, nodeId: node.id },
        location: relativeLocation(input.cwd, input.filePath),
        message: `Node ${node.id} references unresolved catalog item ${node.catalogItemId}.`,
      }));
      continue;
    }
    const item = input.catalog.get(node.catalogItemId);
    const source = item?.implementation?.source;
    if (!source) continue;
    const exists = resolveCatalogSource(input.cwd, source);
    if (exists) continue;
    const sourceLooksLikeManifest = source.includes("/manifest") || source.includes("catalog/items/");
    errors.push(validateError({
      code: sourceLooksLikeManifest ? "MISSING_CATALOG_ITEM_FILE" : "MISSING_STEP_IMPLEMENTATION",
      details: { catalogItemId: node.catalogItemId, nodeId: node.id, source },
      location: relativeLocation(input.cwd, input.filePath),
      message: `Catalog item ${node.catalogItemId} references missing implementation source ${source}.`,
    }));
  }
  return errors;
}

function validateRenderableWorkflow(input: {
  catalog: Awaited<ReturnType<typeof loadWorkbenchCatalog>>;
  cwd: string;
  document: WorkflowDocument;
  filePath: string;
}): ValidateError[] {
  const model = projectWorkflowDocumentRenderModel({
    catalog: input.catalog,
    document: input.document,
  });
  return validateWorkflowRenderability(model).issues.map((issue) =>
    validateError({
      code: issue.code,
      details: issue.details,
      location: relativeLocation(input.cwd, input.filePath),
      message: issue.message,
      severity: issue.severity,
    })
  );
}

function validateInfraStrings(cwd: string, filePath: string, rawText: string, parsed: unknown): ValidateError[] {
  const location = relativeLocation(cwd, filePath);
  const errors: ValidateError[] = [];
  for (const pattern of INFRA_PATTERNS) {
    if (rawText.includes(pattern)) {
      errors.push(validateError({
        code: "INFRA_IN_WORKFLOW_DOCUMENT",
        details: { pattern },
        location,
        message: `Workflow document contains infrastructure reference ${pattern}.`,
      }));
    }
  }
  for (const value of collectStrings(parsed)) {
    if (looksLikeHostPath(value)) {
      errors.push(validateError({
        code: "INFRA_IN_WORKFLOW_DOCUMENT",
        details: { value },
        location,
        message: "Workflow document contains a host filesystem path.",
      }));
    }
  }
  return dedupeErrors(errors);
}

function validateGlueForWorkflow(cwd: string, workflowId: string): ValidateError[] {
  const glueDir = path.join(cwd, "workflows", workflowId);
  if (!existsSync(glueDir)) {
    return [validateError({
      code: "MISSING_GLUE_FOLDER",
      location: relativeLocation(cwd, glueDir),
      message: `Workflow ${workflowId} has no matching glue folder.`,
      severity: "warning",
    })];
  }
  return [];
}

async function validateGlueFolders(input: {
  cwd: string;
  includeOrphans: boolean;
  workflowIds: Set<string>;
}): Promise<WorkflowValidateResult[]> {
  const workflowsDir = path.join(input.cwd, "workflows");
  if (!existsSync(workflowsDir)) return [];
  const entries = await readdir(workflowsDir, { withFileTypes: true });
  const results: WorkflowValidateResult[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    if (!input.includeOrphans && !input.workflowIds.has(id)) continue;
    const glueDir = path.join(workflowsDir, id);
    const errors: ValidateError[] = [];
    if (input.includeOrphans && !input.workflowIds.has(id)) {
      errors.push(validateError({
        code: "ORPHAN_GLUE_FOLDER",
        location: relativeLocation(input.cwd, glueDir),
        message: `Glue folder ${id} has no matching workflow document.`,
        severity: "warning",
      }));
    }
    const workflowTs = path.join(glueDir, "workflow.ts");
    if (existsSync(workflowTs)) {
      const referenced = workflowReferences(await readFile(workflowTs, "utf8"));
      if (referenced.size > 1) {
        errors.push(validateError({
          code: "MULTIPLE_WORKFLOWS_IN_GLUE",
          details: { workflowIds: [...referenced].sort() },
          location: relativeLocation(input.cwd, workflowTs),
          message: `Glue folder ${id} references multiple workflow documents.`,
        }));
      }
      if (referenced.size === 1 && !referenced.has(id)) {
        errors.push(validateError({
          code: "GLUE_FOLDER_MISMATCH",
          details: { folderId: id, workflowIds: [...referenced] },
          location: relativeLocation(input.cwd, workflowTs),
          message: `Glue folder ${id} references workflow ${[...referenced][0]}.`,
        }));
      }
    }
    if (errors.length > 0) {
      results.push({
        errors,
        id,
        valid: !errors.some((error) => error.severity === "error"),
      });
    }
  }
  return results;
}

function rawNodes(raw: RawWorkflowDocument): { catalogItemId?: string; id: string }[] {
  return Array.isArray(raw.nodes)
    ? raw.nodes.flatMap((node) => typeof node.id === "string"
      ? [{ catalogItemId: typeof node.catalogItemId === "string" ? node.catalogItemId : undefined, id: node.id }]
      : [])
    : [];
}

function rawEdges(raw: RawWorkflowDocument): { id: string; source: string; target: string }[] {
  return Array.isArray(raw.edges)
    ? raw.edges.flatMap((edge, index) => typeof edge.source === "string" && typeof edge.target === "string"
      ? [{ id: typeof edge.id === "string" ? edge.id : `edge-${index + 1}`, source: edge.source, target: edge.target }]
      : [])
    : [];
}

function reachableIds(triggerId: string, edges: { source: string; target: string }[]): Set<string> {
  const bySource = new Map<string, string[]>();
  for (const edge of edges) {
    bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), edge.target]);
  }
  const reachable = new Set<string>();
  const queue = [triggerId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    queue.push(...(bySource.get(id) ?? []));
  }
  return reachable;
}

function workflowReferences(text: string): Set<string> {
  const references = new Set<string>();
  for (const match of text.matchAll(/\.dromio\/workflows\/([^"')]+)\.workflow\.json/g)) {
    if (match[1]) references.add(match[1]);
  }
  return references;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap(collectStrings);
}

function looksLikeHostPath(value: string): boolean {
  const macOsUserRoot = ["", "Users", ""].join("/");
  return value.startsWith(macOsUserRoot) ||
    value.startsWith("/home/") ||
    value.startsWith("/tmp/") ||
    /^~\//.test(value) ||
    /^[A-Z]:\\/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
