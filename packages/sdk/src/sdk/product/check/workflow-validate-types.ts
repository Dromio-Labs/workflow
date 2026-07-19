import {
  workflowRenderValidationIssueCodes,
  type WorkflowRenderValidationIssueCode,
} from "../../client/workflow-render/index.js";

export const workflowValidateErrorCodes = [
  "MISSING_WORKFLOW_ID",
  "MISSING_TRIGGER",
  "MISSING_END",
  "UNREACHABLE_NODE",
  "ORPHAN_EDGE",
  "END_UNREACHABLE",
  "UNRESOLVED_CATALOG_ITEM",
  "INFRA_IN_WORKFLOW_DOCUMENT",
  "GLUE_FOLDER_MISMATCH",
  "MULTIPLE_WORKFLOWS_IN_GLUE",
  "MISSING_GLUE_FOLDER",
  "ORPHAN_GLUE_FOLDER",
  "MISSING_CATALOG_ITEM_FILE",
  "MISSING_STEP_IMPLEMENTATION",
  ...workflowRenderValidationIssueCodes,
] as const;

export type WorkflowValidateErrorCode =
  | Exclude<typeof workflowValidateErrorCodes[number], WorkflowRenderValidationIssueCode>
  | WorkflowRenderValidationIssueCode;

export type WorkflowValidateSeverity = "error" | "warning";

export interface ValidateError {
  code: WorkflowValidateErrorCode;
  details?: Record<string, unknown>;
  location: string;
  message: string;
  severity: WorkflowValidateSeverity;
}

export interface WorkflowValidateResult {
  errors: ValidateError[];
  id: string;
  valid: boolean;
}

export interface ValidateOutput {
  summary: {
    errorCount: number;
    failed: number;
    passed: number;
    total: number;
  };
  valid: boolean;
  workbench: string;
  workflows: WorkflowValidateResult[];
}

export interface DromioValidateInput {
  cwd?: string;
  mode?: "full" | "render-only";
  workflowId?: string;
}

export class DromioValidateUsageError extends Error {
  readonly exitCode = 2;
}
