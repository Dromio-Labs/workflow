import type {
  StepContractSourceMap,
} from "../../../core/index.js";
import {
  normalizeOperationContract,
} from "../../../core/index.js";
import type {
  WorkflowCatalog,
} from "../../catalog/index.js";
import {
  workflowDocumentSchema,
  type WorkflowDocument,
  type WorkflowDocumentContract,
  type WorkflowDocumentNode,
} from "../schema.js";
import {
  jsonSchemaCompatible,
} from "./json-schema.js";
import {
  orderedNodes,
  reachableIds,
} from "./order.js";
import type {
  WorkflowDocumentValidateInput,
  WorkflowDocumentValidation,
  WorkflowDocumentValidationIssue,
} from "./types.js";

export function validateWorkflowDocument(
  document: WorkflowDocument,
  input: WorkflowDocumentValidateInput = {},
): WorkflowDocumentValidation {
  const issues: WorkflowDocumentValidationIssue[] = [];
  const parsed = workflowDocumentSchema.safeParse(document);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        code: "document.schema",
        message: issue.message,
        path: issue.path.join("."),
        severity: "error",
      });
    }
    return { issues, ok: false };
  }

  const nodeIds = new Set(document.nodes.map((node) => node.id));
  const allIds = new Set([document.trigger.id, document.end.id, ...nodeIds]);
  if (allIds.size !== document.nodes.length + 2) {
    issues.push({
      code: "document.duplicate-id",
      message: "Workflow document ids must be unique across trigger, nodes, and end.",
      severity: "error",
    });
  }
  for (const edge of document.edges) {
    if (edge.source === document.end.id) {
      issues.push({
        code: "edge.source-end",
        message: `Edge ${edge.id} starts at end boundary ${document.end.id}.`,
        path: `edges.${edge.id}.source`,
        severity: "error",
      });
    }
    if (edge.target === document.trigger.id) {
      issues.push({
        code: "edge.target-trigger",
        message: `Edge ${edge.id} targets trigger boundary ${document.trigger.id}.`,
        path: `edges.${edge.id}.target`,
        severity: "error",
      });
    }
    if (!allIds.has(edge.source)) {
      issues.push({
        code: "edge.source",
        message: `Edge ${edge.id} references unknown source ${edge.source}.`,
        path: `edges.${edge.id}.source`,
        severity: "error",
      });
    }
    if (!allIds.has(edge.target)) {
      issues.push({
        code: "edge.target",
        message: `Edge ${edge.id} references unknown target ${edge.target}.`,
        path: `edges.${edge.id}.target`,
        severity: "error",
      });
    }
  }
  for (const loop of document.loops ?? []) {
    if (!nodeIds.has(loop.start)) {
      issues.push({
        code: "loop.start",
        message: `Loop ${loop.id} references unknown start node ${loop.start}.`,
        path: `loops.${loop.id}.start`,
        severity: "error",
      });
    }
    if (!nodeIds.has(loop.end)) {
      issues.push({
        code: "loop.end",
        message: `Loop ${loop.id} references unknown end node ${loop.end}.`,
        path: `loops.${loop.id}.end`,
        severity: "error",
      });
    }
    if (loop.backTo && !nodeIds.has(loop.backTo)) {
      issues.push({
        code: "loop.back-to",
        message: `Loop ${loop.id} references unknown backTo node ${loop.backTo}.`,
        path: `loops.${loop.id}.backTo`,
        severity: "error",
      });
    }
  }
  const reachable = reachableIds(document);
  for (const node of document.nodes) {
    if (!reachable.has(node.id)) {
      issues.push({
        code: "node.unreachable",
        message: `Node ${node.id} is not reachable from trigger ${document.trigger.id}.`,
        path: `nodes.${node.id}`,
        severity: "error",
      });
    }
  }
  if (!reachable.has(document.end.id)) {
    issues.push({
      code: "end.unreachable",
      message: `End boundary ${document.end.id} is not reachable from trigger ${document.trigger.id}.`,
      path: "end",
      severity: "error",
    });
  }
  if (input.catalog) {
    for (const node of document.nodes) {
      const item = input.catalog.get(node.catalogItemId);
      if (!item) {
        issues.push({
          code: "catalog.missing-item",
          message: `Node ${node.id} references unknown catalog item ${node.catalogItemId}.`,
          path: `nodes.${node.id}.catalogItemId`,
          severity: "error",
        });
        continue;
      }
      validateNodeDefinition(node, item, issues);
    }
    validateBoundaryContracts(document, input.catalog, issues);
    validateNodeInputContracts(document, input.catalog, issues);
  }
  return {
    issues,
    ok: !issues.some((issue) => issue.severity === "error"),
  };
}

function validateBoundaryContracts(
  document: WorkflowDocument,
  catalog: WorkflowCatalog,
  issues: WorkflowDocumentValidationIssue[],
) {
  let nodes: WorkflowDocumentNode[];
  try {
    nodes = orderedNodes(document);
  } catch (error) {
    issues.push({
      code: "graph.cycle",
      message: error instanceof Error ? error.message : "Workflow document contains a cycle.",
      path: "edges",
      severity: "error",
    });
    return;
  }
  const firstNode = nodes[0];
  if (firstNode) {
    const item = catalog.get(firstNode.catalogItemId);
    if (item) {
      compareContractKeys({
        actual: document.trigger.input,
        boundary: "trigger",
        code: "boundary.trigger-input-mismatch",
        expected: remapContractSources(item.inputs, firstNode.bindings?.input),
        path: "trigger.input",
        target: firstNode.id,
        side: "input",
        issues,
      });
    }
  }
  const lastNode = nodes.at(-1);
  if (!lastNode) return;
  const item = catalog.get(lastNode.catalogItemId);
  if (!item) return;
  compareContractKeys({
    actual: document.end.output,
    boundary: "end",
    code: "boundary.end-output-mismatch",
    expected: remapContractSources(item.outputs, lastNode.bindings?.output),
    path: "end.output",
    target: lastNode.id,
    side: "output",
    issues,
  });
}

function compareContractKeys(input: {
  actual: Record<string, WorkflowDocumentContract> | undefined;
  boundary: "end" | "trigger";
  code: string;
  expected: StepContractSourceMap | undefined;
  issues: WorkflowDocumentValidationIssue[];
  path: string;
  side: "input" | "output";
  target: string;
}) {
  const actualKeys = Object.keys(input.actual ?? {}).sort();
  const expectedKeys = Object.keys(input.expected ?? {}).sort();
  if (expectedKeys.length > 0 && actualKeys.length === 0) {
    input.issues.push({
      code: `${input.code}.missing`,
      message: `${capitalize(input.boundary)} ${input.side} must declare keys [${expectedKeys.join(", ")}] to match ${input.target}.`,
      path: input.path,
      severity: "error",
    });
    return;
  }
  if (!sameStringArray(actualKeys, expectedKeys)) {
    input.issues.push({
      code: input.code,
      message: `${capitalize(input.boundary)} ${input.side} keys [${actualKeys.join(", ")}] do not match ${input.target} ${input.side} keys [${expectedKeys.join(", ")}].`,
      path: input.path,
      severity: "error",
    });
  }
  for (const key of actualKeys.filter((value) => expectedKeys.includes(value))) {
    const actualSchema = input.actual?.[key]?.jsonSchema;
    const expectedSource = input.expected?.[key];
    const expectedSchema = expectedSource
      ? normalizeOperationContract(`${input.target}.${input.side}.${key}`, expectedSource).jsonSchema
      : undefined;
    if (!expectedSchema) continue;
    const sourceSchema = input.side === "output" ? expectedSchema : actualSchema;
    const targetSchema = input.side === "output" ? actualSchema : expectedSchema;
    if (sourceSchema && targetSchema && jsonSchemaCompatible(sourceSchema, targetSchema)) continue;
    input.issues.push({
      code: `${input.code}.schema`,
      message: `${capitalize(input.boundary)} ${input.side} key ${key} is not schema-compatible with ${input.target}.${key}.`,
      path: `${input.path}.${key}.jsonSchema`,
      severity: "error",
    });
  }
}

function validateNodeInputContracts(
  document: WorkflowDocument,
  catalog: WorkflowCatalog,
  issues: WorkflowDocumentValidationIssue[],
) {
  let nodes: WorkflowDocumentNode[];
  try {
    nodes = orderedNodes(document);
  } catch {
    return;
  }
  const available = new Map<string, { schema?: unknown; source: string }>();
  for (const [key, contract] of Object.entries(document.trigger.input ?? {})) {
    available.set(key, {
      schema: contract.jsonSchema,
      source: document.trigger.id,
    });
  }
  for (const node of nodes) {
    const item = catalog.get(node.catalogItemId);
    if (!item) continue;
    for (const [key, source] of Object.entries(item.inputs ?? {})) {
      const requiredSchema = normalizeOperationContract(`${node.id}.input.${key}`, source).jsonSchema;
      const sourceKey = node.bindings?.input?.[key] ?? key;
      const provided = available.get(sourceKey);
      if (!provided) {
        issues.push({
          code: "node.input-unavailable",
          message: `Node ${node.id} requires input ${key} from ${sourceKey}, but no prior trigger or node output provides it.`,
          path: `nodes.${node.id}.input.${key}`,
          severity: "error",
        });
        continue;
      }
      if (requiredSchema && (!provided.schema || !jsonSchemaCompatible(provided.schema, requiredSchema))) {
        issues.push({
          code: "node.input-schema",
          message: `Node ${node.id} input ${key} is not schema-compatible with ${provided.source}.${sourceKey}.`,
          path: `nodes.${node.id}.input.${key}`,
          severity: "error",
        });
      }
    }
    for (const [key, source] of Object.entries(item.outputs ?? {})) {
      const targetKey = node.bindings?.output?.[key] ?? key;
      available.set(targetKey, {
        schema: normalizeOperationContract(`${node.id}.output.${key}`, source).jsonSchema,
        source: node.id,
      });
    }
  }
}

function validateNodeDefinition(
  node: WorkflowDocumentNode,
  item: NonNullable<ReturnType<WorkflowCatalog["get"]>>,
  issues: WorkflowDocumentValidationIssue[],
) {
  if (node.kind && item.kind && node.kind !== item.kind) {
    issues.push({
      code: "node.kind-mismatch",
      message: `Node ${node.id} declares kind ${node.kind}, but catalog item ${item.id} is ${item.kind}.`,
      path: `nodes.${node.id}.kind`,
      severity: "error",
    });
  }
  validateBindingSide(node, "input", item.inputs, issues);
  validateBindingSide(node, "output", item.outputs, issues);
}

function validateBindingSide(
  node: WorkflowDocumentNode,
  side: "input" | "output",
  contracts: StepContractSourceMap | undefined,
  issues: WorkflowDocumentValidationIssue[],
) {
  const bindings = node.bindings?.[side];
  if (!bindings) return;
  const contractKeys = new Set(Object.keys(contracts ?? {}));
  const targets = new Set<string>();
  for (const [port, target] of Object.entries(bindings)) {
    if (!contractKeys.has(port)) {
      issues.push({
        code: `node.binding-${side}-port`,
        message: `Node ${node.id} binds unknown ${side} port ${port}.`,
        path: `nodes.${node.id}.bindings.${side}.${port}`,
        severity: "error",
      });
    }
    if (targets.has(target)) {
      issues.push({
        code: `node.binding-${side}-collision`,
        message: `Node ${node.id} maps more than one ${side} port to ${target}.`,
        path: `nodes.${node.id}.bindings.${side}.${port}`,
        severity: "error",
      });
    }
    targets.add(target);
  }
}

function remapContractSources(
  contracts: StepContractSourceMap | undefined,
  bindings: Record<string, string> | undefined,
): StepContractSourceMap | undefined {
  if (!contracts || !bindings) return contracts;
  return Object.fromEntries(Object.entries(contracts).map(([key, contract]) => [
    bindings[key] ?? key,
    contract,
  ]));
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function capitalize(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
