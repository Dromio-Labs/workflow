import type {
  QuestionResolverRegistry,
  loop,
} from "../../../core/index.js";
import type {
  WorkflowCatalog,
} from "../../catalog/index.js";
import type {
  ModelWorkerSource,
} from "../../model/index.js";
import type {
  WorkflowDocument,
  WorkflowDocumentEdge,
  WorkflowDocumentNode,
  WorkflowDocumentTrigger,
} from "../schema.js";

export type WorkflowDocumentValidationIssue = {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
};

export type WorkflowDocumentValidation = {
  issues: WorkflowDocumentValidationIssue[];
  ok: boolean;
};

export type WorkflowDocumentEditor = {
  addStep(node: WorkflowDocumentNode, input?: { after?: string; before?: string }): WorkflowDocument;
  compile<TUse = unknown>(input: WorkflowDocumentCompileInput<TUse>): ReturnType<typeof loop<TUse, unknown>>;
  connect(edge: Omit<WorkflowDocumentEdge, "id"> & { id?: string }): WorkflowDocument;
  document(): WorkflowDocument;
  moveStep(input: { after?: string; before?: string; stepId: string }): WorkflowDocument;
  updateStepConfig(stepId: string, patch: Record<string, unknown>): WorkflowDocument;
  updateTrigger(patch: Partial<WorkflowDocumentTrigger>): WorkflowDocument;
  validate(input?: WorkflowDocumentValidateInput): WorkflowDocumentValidation;
};

export type WorkflowDocumentValidateInput = {
  catalog?: WorkflowCatalog;
};

export type WorkflowDocumentCompileInput<TUse = unknown> = {
  catalog: WorkflowCatalog;
  childWorkflows?: Record<string, WorkflowDocumentChildWorkflowSource>;
  config?: object;
  model?: ModelWorkerSource;
  models?: Record<string, ModelWorkerSource>;
  questionResolvers?: QuestionResolverRegistry;
  use?: TUse;
};

export type WorkflowDocumentChildWorkflowSource = {
  catalog?: WorkflowCatalog;
  document: WorkflowDocument;
};
