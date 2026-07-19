import type {
  LoopGraphProjection,
} from "../../../core/index.js";
import type {
  WorkflowCatalog,
} from "../../catalog/index.js";
import {
  compileWorkflowDocument,
  validateWorkflowDocument,
  type WorkflowDocumentCompileInput,
  type WorkflowDocumentValidation,
  type WorkflowDocumentValidationIssue,
} from "../editor.js";
import {
  workflowDocumentSchema,
  type WorkflowDocument,
} from "../schema.js";
import type {
  WorkflowWorkspaceStatus,
} from "./types.js";

export function validateWorkflowWorkspaceState<TUse = unknown>(input: {
  catalog?: WorkflowCatalog;
  compile?: Omit<WorkflowDocumentCompileInput<TUse>, "catalog" | "document">;
  document: unknown;
  publishedVersion?: string;
}): {
  compiledGraph?: LoopGraphProjection;
  parsedDocument?: WorkflowDocument;
  validation: WorkflowDocumentValidation;
} {
  const issues: WorkflowDocumentValidationIssue[] = [];
  const parsedDocument = workflowDocumentSchema.safeParse(input.document);
  if (!parsedDocument.success) {
    for (const issue of parsedDocument.error.issues) {
      issues.push({
        code: "document.schema",
        message: issue.message,
        path: issue.path.join("."),
        severity: "error",
      });
    }
    return {
      validation: {
        issues,
        ok: false,
      },
    };
  }

  if (issues.some((issue) => issue.severity === "error")) {
    return {
      parsedDocument: parsedDocument.data,
      validation: {
        issues,
        ok: false,
      },
    };
  }

  const documentValidation = validateWorkflowDocument(parsedDocument.data, {
    catalog: input.catalog,
  });
  issues.push(...documentValidation.issues);
  let compiledGraph: LoopGraphProjection | undefined;
  if (!issues.some((issue) => issue.severity === "error") && input.catalog) {
    try {
      compiledGraph = compileWorkflowDocument({
        ...(input.compile ?? {}),
        catalog: input.catalog,
        document: parsedDocument.data,
      }).graph();
    } catch (error) {
      issues.push({
        code: "document.compile",
        message: error instanceof Error ? error.message : "Workflow document failed to compile.",
        severity: "error",
      });
    }
  }

  return {
    compiledGraph,
    parsedDocument: parsedDocument.data,
    validation: {
      issues,
      ok: !issues.some((issue) => issue.severity === "error"),
    },
  };
}

export function workflowWorkspaceStatus(
  validation: WorkflowDocumentValidation,
  publishedVersion: string | undefined,
): WorkflowWorkspaceStatus {
  if (!validation.ok) return "draft";
  if (publishedVersion) return "published";
  return "valid";
}
