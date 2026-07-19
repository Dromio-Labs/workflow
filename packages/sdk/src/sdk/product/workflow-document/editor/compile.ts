import type {
  LoopGraphCatalogItem,
  LoopGraphChildNode,
  LoopGraphProjection,
  StepContractSourceMap,
} from "../../../core/index.js";
import {
  defineOperationContract,
  loop,
  normalizeOperationContract,
} from "../../../core/index.js";
import type {
  WorkflowCatalog,
  WorkflowCatalogItem,
} from "../../catalog/index.js";
import type {
  WorkflowDocument,
  WorkflowDocumentContract,
  WorkflowDocumentLoop,
  WorkflowDocumentNode,
} from "../schema.js";
import {
  orderedNodes,
} from "./order.js";
import type {
  WorkflowDocumentChildWorkflowSource,
  WorkflowDocumentCompileInput,
} from "./types.js";
import {
  validateWorkflowDocument,
} from "./validation.js";

export function compileWorkflowDocument<TUse = unknown>(
  input: WorkflowDocumentCompileInput<TUse> & { document: WorkflowDocument },
) {
  const validation = validateWorkflowDocument(input.document, {
    catalog: input.catalog,
  });
  if (!validation.ok) {
    throw new Error(validation.issues.map((issue) => issue.message).join("\n"));
  }
  const nodes = orderedNodes(input.document);
  const workflow = loop({
    description: input.document.description,
    end: {
      boundary: "end",
      ...(input.document.end.config ? { config: input.document.end.config } : {}),
      description: input.document.end.description,
      id: input.document.end.id,
      label: input.document.end.label,
      output: documentContractsToStepContracts(
        input.document,
        input.document.end.id,
        "output",
        input.document.end.output,
      ),
      type: input.document.end.type ?? "result",
    },
    id: input.document.id,
    label: input.document.label,
    questionResolvers: input.questionResolvers,
    steps: nodes.map((node) => {
      const created = input.catalog.createStep(node.catalogItemId, {
        config: {
          ...(input.config ?? {}),
          ...(node.config ?? {}),
        },
        model: input.models?.[node.id] ?? input.model,
        stepId: node.id,
      });
      return {
        ...applyNodeBindings(created, node),
        description: node.description ?? created.description,
        kind: node.kind ?? created.kind,
        label: node.label ?? created.label,
      };
    }),
    trigger: {
      boundary: "trigger",
      ...(input.document.trigger.config ? { config: input.document.trigger.config } : {}),
      description: input.document.trigger.description,
      id: input.document.trigger.id,
      input: documentContractsToStepContracts(
        input.document,
        input.document.trigger.id,
        "input",
        input.document.trigger.input,
      ),
      label: input.document.trigger.label,
      type: input.document.trigger.type,
    },
    use: input.use,
  });
  return {
    ...workflow,
    graph() {
      return applyWorkflowDocumentMetadataToGraph(
        workflow.graph(),
        input.document,
        input.catalog,
        input.childWorkflows,
      );
    },
  };
}

function applyNodeBindings(
  step: ReturnType<WorkflowCatalog["createStep"]>,
  node: WorkflowDocumentNode,
): ReturnType<WorkflowCatalog["createStep"]> {
  const inputBindings = node.bindings?.input;
  const outputBindings = node.bindings?.output;
  if (!inputBindings && !outputBindings) return step;
  return {
    ...step,
    input: remapContracts(step.input, inputBindings),
    output: remapContracts(step.output, outputBindings),
    async run(context) {
      const state = remapInputValues(context.state, context.input, inputBindings);
      const workflowInput = remapWorkflowInput(context.input, inputBindings);
      const result = await step.run({ ...context, input: workflowInput, state });
      if (result.type !== "done" || !isRecord(result.output)) return result;
      return {
        ...result,
        output: remapOutputValues(result.output, outputBindings),
      };
    },
  };
}

function remapContracts<TContracts extends Record<string, unknown> | undefined>(
  contracts: TContracts,
  bindings: Record<string, string> | undefined,
): TContracts {
  if (!contracts || !bindings) return contracts;
  return Object.fromEntries(Object.entries(contracts).map(([key, contract]) => [
    bindings[key] ?? key,
    contract,
  ])) as TContracts;
}

function remapInputValues(
  state: Record<string, unknown>,
  workflowInput: unknown,
  bindings: Record<string, string> | undefined,
) {
  if (!bindings) return state;
  const mapped = { ...state };
  const input = isRecord(workflowInput) ? workflowInput : {};
  for (const [target, source] of Object.entries(bindings)) {
    if (source in state) mapped[target] = state[source];
    else if (source in input) mapped[target] = input[source];
  }
  return mapped;
}

function remapWorkflowInput(
  workflowInput: unknown,
  bindings: Record<string, string> | undefined,
) {
  if (!bindings || !isRecord(workflowInput)) return workflowInput;
  const mapped = { ...workflowInput };
  for (const [target, source] of Object.entries(bindings)) {
    if (source in workflowInput) mapped[target] = workflowInput[source];
  }
  return mapped;
}

function remapOutputValues(
  output: Record<string, unknown>,
  bindings: Record<string, string> | undefined,
) {
  if (!bindings) return output;
  const mapped = { ...output };
  for (const [source, target] of Object.entries(bindings)) {
    if (!(source in output)) continue;
    if (source !== target) delete mapped[source];
    mapped[target] = output[source];
  }
  return mapped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function applyWorkflowDocumentMetadataToGraph(
  graph: LoopGraphProjection,
  document: WorkflowDocument,
  catalog: WorkflowCatalog,
  childWorkflows: Record<string, WorkflowDocumentChildWorkflowSource> | undefined,
): LoopGraphProjection {
  const documentNodes = new Map(document.nodes.map((node) => [node.id, node]));
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const documentNode = documentNodes.get(node.id);
      if (!documentNode) return node;
      const item = catalog.get(documentNode.catalogItemId);
      if (!item) return {
        ...node,
        catalogItemId: documentNode.catalogItemId,
      };
      return {
        ...node,
        catalog: graphCatalogItem(item),
        catalogItemId: item.id,
        childNodes: graphCatalogChildNodes(item, catalog, childWorkflows),
        description: node.description ?? item.description,
      };
    }),
  };
}

function graphCatalogChildNodes(
  item: WorkflowCatalogItem,
  catalog: WorkflowCatalog,
  childWorkflows: Record<string, WorkflowDocumentChildWorkflowSource> | undefined,
): LoopGraphChildNode[] | undefined {
  const routerRoutes = item.execution?.kind === "router"
    ? item.execution.routes ?? []
    : [];
  const routerChildNodes = routerRoutes.flatMap((route) => {
    const childWorkflow = childWorkflows?.[route.childWorkflowDocumentId];
    return childWorkflow
      ? graphWorkflowDocumentChildNodes(childWorkflow, catalog, undefined, {
          id: route.id,
          label: route.label,
        }) ?? []
      : [];
  });
  if (routerChildNodes.length > 0) return routerChildNodes;
  const forkBranches = item.execution?.kind === "fork"
    ? item.execution.branches ?? []
    : [];
  const forkChildNodes = forkBranches.flatMap((branch) => {
    const childWorkflow = childWorkflows?.[branch.childWorkflowDocumentId];
    return childWorkflow
      ? graphWorkflowDocumentChildNodes(childWorkflow, catalog, {
          id: branch.id,
          label: branch.label,
        }) ?? []
      : [];
  });
  if (forkChildNodes.length > 0) return forkChildNodes;
  const childWorkflowId = item.execution?.childWorkflowDocumentId;
  const childWorkflow = childWorkflowId ? childWorkflows?.[childWorkflowId] : undefined;
  if (childWorkflow) {
    return graphWorkflowDocumentChildNodes(childWorkflow, catalog);
  }
  const children = item.implementation?.children ?? [];
  if (children.length === 0) return undefined;
  return children.map((id) => {
    const child = catalog.get(id);
    if (!child) {
      return {
        catalogItemId: id,
        id,
        label: id,
      };
    }
    return {
      catalog: graphCatalogItem(child),
      catalogItemId: child.id,
      description: child.description,
      id: child.id,
      input: graphCatalogPorts(child.id, "input", child.inputs),
      kind: child.kind,
      label: child.label,
      output: graphCatalogPorts(child.id, "output", child.outputs),
    };
  });
}

function graphWorkflowDocumentChildNodes(
  source: WorkflowDocumentChildWorkflowSource,
  fallbackCatalog: WorkflowCatalog,
  branch?: { id: string; label?: string },
  route?: { id: string; label?: string },
): LoopGraphChildNode[] | undefined {
  const nodes = orderedNodes(source.document);
  if (nodes.length === 0) return undefined;
  const catalog = source.catalog ?? fallbackCatalog;
  const loops = workflowDocumentChildLoopMetadata(source.document, nodes);
  return nodes.map((node) => {
    const child = catalog.get(node.catalogItemId);
    if (!child) {
      return {
        ...(branch ? { branch } : {}),
        ...(route ? { route } : {}),
        catalogItemId: node.catalogItemId,
        description: node.description,
        id: branch ? `${branch.id}.${node.id}` : route ? `${route.id}.${node.id}` : node.id,
        label: node.label ?? node.id,
        loop: loops.get(node.id),
      };
    }
    return {
      ...(branch ? { branch } : {}),
      ...(route ? { route } : {}),
      catalog: graphCatalogItem(child),
      catalogItemId: child.id,
      description: node.description ?? child.description,
      id: branch ? `${branch.id}.${node.id}` : route ? `${route.id}.${node.id}` : node.id,
      input: graphCatalogPorts(child.id, "input", child.inputs),
      kind: child.kind,
      label: node.label ?? child.label,
      loop: loops.get(node.id),
      output: graphCatalogPorts(child.id, "output", child.outputs),
    };
  });
}

function workflowDocumentChildLoopMetadata(
  document: WorkflowDocument,
  nodes: ReturnType<typeof orderedNodes>,
): Map<string, NonNullable<LoopGraphChildNode["loop"]>> {
  const metadata = new Map<string, NonNullable<LoopGraphChildNode["loop"]>>();
  const indexes = new Map(nodes.map((node, index) => [node.id, index]));
  for (const loop of document.loops ?? []) {
    const startIndex = indexes.get(loop.start);
    const endIndex = indexes.get(loop.end);
    if (startIndex === undefined || endIndex === undefined) continue;
    const from = Math.min(startIndex, endIndex);
    const to = Math.max(startIndex, endIndex);
    for (const node of nodes.slice(from, to + 1)) {
      metadata.set(node.id, {
        backToNodeId: loop.backTo ?? loop.start,
        endNodeId: loop.end,
        id: loop.id,
        label: loop.label,
        role: loopRole(loop, node.id),
        startNodeId: loop.start,
      });
    }
  }
  return metadata;
}

function loopRole(loop: WorkflowDocumentLoop, nodeId: string): NonNullable<LoopGraphChildNode["loop"]>["role"] {
  if (nodeId === loop.end) return "end";
  if (nodeId === loop.start) return "start";
  return "body";
}

function graphCatalogItem(item: WorkflowCatalogItem): LoopGraphCatalogItem {
  return {
    capabilities: item.capabilities,
    description: item.description,
    execution: item.execution,
    id: item.id,
    implementation: item.implementation,
    intents: item.intents,
    kind: item.kind,
    label: item.label,
    sideEffects: item.sideEffects,
    tags: item.tags,
    verbs: item.verbs,
  };
}

function graphCatalogPorts(
  itemId: string,
  side: "input" | "output",
  contracts: StepContractSourceMap | undefined,
) {
  const entries = Object.entries(contracts ?? {});
  if (entries.length === 0) return undefined;
  return entries.map(([key, source]) => {
    const contract = normalizeOperationContract(`${itemId}.${side}.${key}`, source);
    return {
      contractId: contract.id,
      jsonSchema: contract.jsonSchema,
      key,
    };
  });
}

function documentContractsToStepContracts(
  document: WorkflowDocument,
  boundaryId: string,
  side: "input" | "output",
  contracts: Record<string, WorkflowDocumentContract> | undefined,
): StepContractSourceMap | undefined {
  const entries = Object.entries(contracts ?? {});
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([key, contract]) => [
    key,
    defineOperationContract({
      id: `${document.id}.${boundaryId}.${side}.${key}`,
      jsonSchema: contract.jsonSchema,
    }),
  ]));
}
