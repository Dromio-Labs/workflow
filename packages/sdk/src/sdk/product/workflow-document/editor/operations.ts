import {
  workflowDocumentSchema,
  type WorkflowDocument,
  type WorkflowDocumentEdge,
  type WorkflowDocumentNode,
  type WorkflowDocumentTrigger,
} from "../schema.js";
import {
  compileWorkflowDocument,
} from "./compile.js";
import {
  ensureUniqueNodeId,
  insertNode,
  orderedNodes,
  sequenceEdges,
} from "./order.js";
import type {
  WorkflowDocumentEditor,
} from "./types.js";
import {
  validateWorkflowDocument,
} from "./validation.js";

export function createWorkflowDocument(input: Omit<WorkflowDocument, "edges" | "version"> & {
  edges?: WorkflowDocumentEdge[];
  version?: 1;
}): WorkflowDocument {
  const parsed = workflowDocumentSchema.parse({
    ...input,
    edges: input.edges ?? sequenceEdges(input.trigger.id, input.nodes, input.end.id),
    version: input.version ?? 1,
  });
  return parsed;
}

export function createWorkflowEditor(input: WorkflowDocument): WorkflowDocumentEditor {
  let current = workflowDocumentSchema.parse(input);
  const set = (next: WorkflowDocument) => {
    current = workflowDocumentSchema.parse(next);
    return current;
  };
  return {
    addStep(node, options) {
      return set(workflowEditor.addStep(current, node, options));
    },
    compile(compileInput) {
      return compileWorkflowDocument({ ...compileInput, document: current });
    },
    connect(edge) {
      return set(workflowEditor.connect(current, edge));
    },
    document() {
      return current;
    },
    moveStep(input) {
      return set(workflowEditor.moveStep(current, input));
    },
    updateStepConfig(stepId, patch) {
      return set(workflowEditor.updateStepConfig(current, stepId, patch));
    },
    updateTrigger(patch) {
      return set(workflowEditor.updateTrigger(current, patch));
    },
    validate(input) {
      return validateWorkflowDocument(current, input);
    },
  };
}

export const workflowEditor = {
  addStep(
    document: WorkflowDocument,
    node: WorkflowDocumentNode,
    input: { after?: string; before?: string } = {},
  ): WorkflowDocument {
    ensureUniqueNodeId(document, node.id);
    const nodes = insertNode(orderedNodes(document), node, input);
    return {
      ...document,
      edges: sequenceEdges(document.trigger.id, nodes, document.end.id),
      nodes,
    };
  },
  connect(
    document: WorkflowDocument,
    edge: Omit<WorkflowDocumentEdge, "id"> & { id?: string },
  ): WorkflowDocument {
    const next = {
      id: edge.id ?? `${edge.source}->${edge.target}`,
      source: edge.source,
      target: edge.target,
    };
    return {
      ...document,
      edges: [
        ...document.edges.filter((item) => item.id !== next.id),
        next,
      ],
    };
  },
  moveStep(
    document: WorkflowDocument,
    input: { after?: string; before?: string; stepId: string },
  ): WorkflowDocument {
    const node = document.nodes.find((item) => item.id === input.stepId);
    if (!node) throw new Error(`Unknown workflow document node ${input.stepId}.`);
    const nodes = insertNode(
      orderedNodes(document).filter((item) => item.id !== input.stepId),
      node,
      input,
    );
    return {
      ...document,
      edges: sequenceEdges(document.trigger.id, nodes, document.end.id),
      nodes,
    };
  },
  updateStepConfig(
    document: WorkflowDocument,
    stepId: string,
    patch: Record<string, unknown>,
  ): WorkflowDocument {
    return {
      ...document,
      nodes: document.nodes.map((node) => node.id === stepId
        ? {
          ...node,
          config: {
            ...(node.config ?? {}),
            ...patch,
          },
        }
        : node),
    };
  },
  updateTrigger(
    document: WorkflowDocument,
    patch: Partial<WorkflowDocumentTrigger>,
  ): WorkflowDocument {
    return workflowDocumentSchema.parse({
      ...document,
      trigger: {
        ...document.trigger,
        ...patch,
        config: {
          ...(document.trigger.config ?? {}),
          ...(patch.config ?? {}),
        },
      },
    });
  },
};
