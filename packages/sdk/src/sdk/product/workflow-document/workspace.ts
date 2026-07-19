export {
  createWorkflowDocumentRenderer,
  createWorkflowWorkspace,
} from "./workspace/factory.js";
export {
  workflowPatchOperationSchema,
  workflowPatchRecordSchema,
} from "./workspace/patch.js";

export type {
  WorkflowDocumentRenderer,
  WorkflowWorkspace,
  WorkflowWorkspaceFrame,
  WorkflowWorkspaceInput,
  WorkflowWorkspacePatchProposal,
  WorkflowWorkspacePatchProposalInput,
  WorkflowWorkspaceStatus,
  WorkflowWorkspaceTestInput,
  WorkflowWorkspaceTestResult,
} from "./workspace/types.js";
export type {
  WorkflowPatchOperation,
  WorkflowPatchRecord,
  WorkflowPatchRecordInput,
} from "./workspace/patch.js";
