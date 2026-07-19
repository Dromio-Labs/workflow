import {
  compileWorkflowDocument,
  validateWorkflowDocument,
  type WorkflowDocumentValidationIssue,
} from "../editor.js";
import { workflowDocumentSchema } from "../schema.js";
import {
  cloneJson,
} from "./json.js";
import {
  applyWorkflowPatchOperation,
  normalizeWorkflowPatchRecord,
  patchApplyIssue,
  type WorkflowPatchRecord,
} from "./patch.js";
import type {
  WorkflowDocumentRenderer,
  WorkflowWorkspace,
  WorkflowWorkspaceFrame,
  WorkflowWorkspaceInput,
  WorkflowWorkspacePatchProposal,
  WorkflowWorkspacePatchProposalInput,
  WorkflowWorkspaceTestResult,
} from "./types.js";
import {
  validateWorkflowWorkspaceState,
  workflowWorkspaceStatus,
} from "./validation.js";

let patchProposalCounter = 0;

export function createWorkflowWorkspace<TUse = unknown>(
  input: WorkflowWorkspaceInput<TUse>,
): WorkflowWorkspace<TUse> {
  const initialDocument = cloneJson(input.document);
  let document = cloneJson(input.document);
  let patches: WorkflowPatchRecord[] = [];
  let cursor = 0;
  let proposal: WorkflowWorkspacePatchProposal | undefined;
  let publishedVersion = input.publishedVersion;
  let latestTest: WorkflowWorkspaceTestResult | undefined;

  const validationInput = {
    catalog: input.catalog,
    compile: input.compile,
  };

  function currentFrame(latestPatch?: WorkflowPatchRecord, extraIssues: WorkflowDocumentValidationIssue[] = []): WorkflowWorkspaceFrame {
    const state = validateWorkflowWorkspaceState({
      ...validationInput,
      document,
      publishedVersion,
    });
    const validation = extraIssues.length > 0
      ? {
        issues: [...state.validation.issues, ...extraIssues],
        ok: false,
      }
      : state.validation;
    return {
      compiledGraph: validation.ok ? state.compiledGraph : undefined,
      cursor,
      document: cloneJson(document),
      latestPatch,
      latestTest: cloneJson(latestTest),
      parsedDocument: state.parsedDocument,
      patches: patches.slice(0, cursor).map((patch) => cloneJson(patch)),
      proposal: cloneJson(proposal),
      publishedVersion,
      status: workflowWorkspaceStatus(validation, publishedVersion),
      validation,
      workspaceId: input.id,
    };
  }

  function rebuild(nextCursor: number): WorkflowDocumentValidationIssue[] {
    document = cloneJson(initialDocument);
    latestTest = undefined;
    const issues: WorkflowDocumentValidationIssue[] = [];
    for (const record of patches.slice(0, nextCursor)) {
      try {
        document = applyWorkflowPatchOperation(document, record.patch);
      } catch (error) {
        issues.push(patchApplyIssue(record, error));
        break;
      }
    }
    cursor = nextCursor;
    return issues;
  }

  function commitPatchRecord(record: WorkflowPatchRecord): WorkflowDocumentValidationIssue[] {
    if (cursor < patches.length) {
      patches = patches.slice(0, cursor);
    }
    const extraIssues: WorkflowDocumentValidationIssue[] = [];
    try {
      document = applyWorkflowPatchOperation(document, record.patch);
      publishedVersion = undefined;
      latestTest = undefined;
    } catch (error) {
      extraIssues.push(patchApplyIssue(record, error));
    }
    patches.push(record);
    cursor = patches.length;
    record.validationAfter = currentFrame(record, extraIssues).validation;
    return extraIssues;
  }

  function previewProposal(inputProposal: WorkflowWorkspacePatchProposalInput): WorkflowWorkspacePatchProposal {
    const normalized = inputProposal.patches.map((patch) => normalizeWorkflowPatchRecord(patch));
    let previewDocument = cloneJson(document);
    const issues: WorkflowDocumentValidationIssue[] = [];

    for (const record of normalized) {
      try {
        previewDocument = applyWorkflowPatchOperation(previewDocument, record.patch);
      } catch (error) {
        issues.push(patchApplyIssue(record, error));
        break;
      }
    }

    const state = validateWorkflowWorkspaceState({
      ...validationInput,
      document: previewDocument,
      publishedVersion: undefined,
    });
    const validation = issues.length > 0
      ? {
        issues: [...state.validation.issues, ...issues],
        ok: false,
      }
      : state.validation;
    for (const record of normalized) {
      record.validationAfter = validation;
    }
    return {
      compiledGraph: validation.ok ? state.compiledGraph : undefined,
      createdAt: inputProposal.createdAt ?? new Date().toISOString(),
      document: cloneJson(previewDocument),
      id: inputProposal.id ?? `workflow-patch-proposal-${Date.now()}-${++patchProposalCounter}`,
      parsedDocument: state.parsedDocument,
      patches: normalized.map((patch) => cloneJson(patch)),
      title: inputProposal.title,
      validation,
    };
  }

  return {
    acceptProposal() {
      if (!proposal) return currentFrame();
      const accepted = proposal.patches.map((patch) => cloneJson(patch));
      proposal = undefined;
      let latestPatch: WorkflowPatchRecord | undefined;
      let latestIssues: WorkflowDocumentValidationIssue[] = [];
      for (const record of accepted) {
        latestPatch = record;
        latestIssues = commitPatchRecord(record);
      }
      return currentFrame(latestPatch, latestIssues);
    },
    applyPatch(inputPatch) {
      proposal = undefined;
      const record = normalizeWorkflowPatchRecord(inputPatch);
      const extraIssues = commitPatchRecord(record);
      const frame = currentFrame(record, extraIssues);
      record.validationAfter = frame.validation;
      return {
        ...frame,
        latestPatch: cloneJson(record),
        patches: patches.slice(0, cursor).map((patch) => cloneJson(patch)),
      };
    },
    compile() {
      return compileCurrentWorkflow();
    },
    document() {
      return cloneJson(document);
    },
    frame() {
      return currentFrame();
    },
    patches() {
      return patches.slice(0, cursor).map((patch) => cloneJson(patch));
    },
    proposePatches(inputProposal) {
      proposal = previewProposal(inputProposal);
      return currentFrame();
    },
    publish(publishInput = {}) {
      if (proposal) {
        throw new Error(`Accept or reject proposed workflow patches before publishing workspace ${input.id}.`);
      }
      const frame = currentFrame();
      if (!frame.validation.ok) {
        throw new Error(`Cannot publish invalid workflow workspace ${input.id}.`);
      }
      publishedVersion = publishInput.version ?? new Date().toISOString();
      return currentFrame();
    },
    rejectProposal() {
      proposal = undefined;
      return currentFrame();
    },
    redo() {
      if (cursor >= patches.length) return currentFrame();
      proposal = undefined;
      const issues = rebuild(cursor + 1);
      publishedVersion = undefined;
      return currentFrame(patches[cursor - 1], issues);
    },
    status() {
      return currentFrame().status;
    },
    async test(testInput) {
      if (proposal) {
        throw new Error(`Accept or reject proposed workflow patches before testing workspace ${input.id}.`);
      }
      const frame = currentFrame();
      if (!frame.validation.ok) {
        throw new Error(`Cannot test invalid workflow workspace ${input.id}.`);
      }
      const workflow = compileCurrentWorkflow();
      if (!workflow) {
        throw new Error(`Cannot compile workflow workspace ${input.id} for testing.`);
      }
      const events: unknown[] = [];
      const startedAt = new Date();
      const startedMs = Date.now();
      try {
        const session = await workflow.start(testInput.input, {
          answers: testInput.answers,
          onEvent(event) {
            events.push(event);
          },
          questionResolvers: testInput.questionResolvers,
          runId: testInput.runId,
        });
        latestTest = {
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
          eventCount: events.length,
          input: cloneJson(testInput.input),
          runId: session.runId,
          startedAt: startedAt.toISOString(),
          state: cloneJson(session.state),
          status: session.status,
        };
        return cloneJson(latestTest);
      } catch (error) {
        latestTest = {
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
          error: error instanceof Error ? error.message : String(error),
          eventCount: events.length,
          input: cloneJson(testInput.input),
          runId: testInput.runId,
          startedAt: startedAt.toISOString(),
          status: "failed",
        };
        return cloneJson(latestTest);
      }
    },
    undo() {
      if (cursor === 0) return currentFrame();
      proposal = undefined;
      const issues = rebuild(cursor - 1);
      publishedVersion = undefined;
      return currentFrame(patches[cursor - 1], issues);
    },
    validate() {
      return currentFrame();
    },
  };

  function compileCurrentWorkflow() {
    const parsedDocument = workflowDocumentSchema.safeParse(document);
    if (!parsedDocument.success || !input.catalog) return undefined;
    const validation = validateWorkflowDocument(parsedDocument.data, {
      catalog: input.catalog,
    });
    if (!validation.ok) return undefined;
    return compileWorkflowDocument({
      ...(input.compile ?? {}),
      catalog: input.catalog,
      document: parsedDocument.data,
    });
  }
}

export function createWorkflowDocumentRenderer(input: {
  workspace: WorkflowWorkspace;
}): WorkflowDocumentRenderer {
  return {
    async *consume(patchStream) {
      for await (const patch of patchStream) {
        yield input.workspace.applyPatch(patch);
      }
    },
    frame() {
      return input.workspace.frame();
    },
  };
}
