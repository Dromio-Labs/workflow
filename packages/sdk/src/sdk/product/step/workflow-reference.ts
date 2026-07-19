import type {
  ChildWorkflowSession,
  RunnableChildWorkflow,
} from "../workflow/child-workflow.js";

export type WorkflowReference<
  TId extends string = string,
  TDocumentId extends string = string,
> = {
  documentId: TDocumentId;
  id: TId;
};

export function assertWorkflowIdentity<
  TInput,
  TSession extends ChildWorkflowSession,
>(
  reference: WorkflowReference,
  workflow: RunnableChildWorkflow<TInput, TSession>,
) {
  if (!workflow.id) {
    throw new Error(`Workflow reference ${reference.id} resolved a runtime workflow without an id.`);
  }
  if (workflow.id !== reference.id) {
    throw new Error(
      `Workflow reference ${reference.id} resolved runtime workflow ${workflow.id}.`,
    );
  }
}
