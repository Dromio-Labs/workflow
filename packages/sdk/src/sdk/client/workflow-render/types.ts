import type {
  LoopGraphProjection,
} from "../../core/index.js";
import type {
  WorkflowRenderInteractionKind,
  WorkflowRenderInteractionState,
  WorkflowRenderModel,
  WorkflowRenderStatus,
  WorkflowRenderTerminalOutcome,
} from "@dromio/workflow-canvas-protocol";
import type { WorkflowTriggerDescriptor } from "@dromio/workflow-room-protocol";

export type {
  WorkflowRenderChildWorkflow,
  WorkflowRenderEdge,
  WorkflowRenderLoop,
  WorkflowRenderModel,
  WorkflowRenderNode,
  WorkflowRenderNodeKind,
  WorkflowRenderNodeSemantic,
  WorkflowRenderPort,
  WorkflowRenderStatus,
} from "@dromio/workflow-canvas-protocol";

export type { WorkflowRendererAdapter } from "@dromio/workflow-canvas-protocol";

export type WorkflowRenderProjectionInput = {
  entryTriggers?: readonly WorkflowRenderEntryTrigger[];
  graph: LoopGraphProjection;
  interactions?: readonly WorkflowRenderInteraction[];
  readOnly?: boolean;
  selectedNodeId?: string;
  selectedRoutes?: Readonly<Record<string, string | undefined>>;
  statuses?: Record<string, WorkflowRenderStatus | undefined>;
  terminalOutcome?: WorkflowRenderTerminalOutcome;
};

export type WorkflowRenderEntryTrigger = WorkflowTriggerDescriptor;

export type WorkflowRenderInteraction = {
  kind: WorkflowRenderInteractionKind;
  state: WorkflowRenderInteractionState;
  stepId: string;
};

export type WorkflowRenderDocumentLike = {
  description?: string;
  edges?: Array<{
    id?: string;
    label?: string;
    metadata?: Record<string, unknown>;
    source?: string;
    sourceHandle?: string;
    target?: string;
    targetHandle?: string;
  }>;
  end?: WorkflowRenderBoundaryLike;
  id?: string;
  label?: string;
  loops?: WorkflowRenderLoopLike[];
  nodes?: WorkflowRenderDocumentNodeLike[];
  trigger?: WorkflowRenderBoundaryLike & { type?: string };
};

export type WorkflowRenderChildWorkflowLike = {
  catalog?: WorkflowRenderCatalogLookup;
  childWorkflows?: Record<string, WorkflowRenderChildWorkflowLike>;
  document: WorkflowRenderDocumentLike;
  selectedNodeId?: string;
};

export type WorkflowRenderLoopLike = {
  backTo?: string;
  backToNodeId?: string;
  end?: string;
  endNodeId?: string;
  id?: string;
  label?: string;
  start?: string;
  startNodeId?: string;
};

export type WorkflowRenderBoundaryLike = {
  description?: string;
  id?: string;
  input?: Record<string, unknown>;
  label?: string;
  metadata?: Record<string, unknown>;
  output?: Record<string, unknown>;
  type?: string;
};

export type WorkflowRenderDocumentNodeLike = {
  catalogItemId?: string;
  childWorkflowId?: string;
  config?: Record<string, unknown>;
  description?: string;
  id?: string;
  input?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  kind?: string;
  label?: string;
  metadata?: Record<string, unknown>;
  output?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  parentId?: string;
  type?: string;
  workflowId?: string;
};

export type WorkflowRenderCatalogLookup = {
  get(id: string): {
    description?: string;
    execution?: {
      branches?: Array<{
        childWorkflowDocumentId: string;
        id: string;
        label?: string;
      }>;
      childWorkflowDocumentId?: string;
      itemLabelPath?: string;
      itemSource?: string;
      joinPolicy?: "all" | "any";
      kind?: string;
      label?: string;
      routes?: Array<{
        childWorkflowDocumentId: string;
        id: string;
        label?: string;
      }>;
    };
    id: string;
    kind?: string;
    label?: string;
  } | undefined;
};
