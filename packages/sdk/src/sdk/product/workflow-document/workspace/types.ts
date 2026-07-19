import type {
  LoopGraphProjection,
  QuestionResolverRegistry,
} from "../../../core/index.js";
import type {
  WorkflowCatalog,
} from "../../catalog/index.js";
import type {
  compileWorkflowDocument,
  WorkflowDocumentCompileInput,
  WorkflowDocumentValidation,
} from "../editor.js";
import type { WorkflowDocument } from "../schema.js";
import type {
  WorkflowPatchRecord,
  WorkflowPatchRecordInput,
} from "./patch.js";

export type WorkflowWorkspaceStatus = "draft" | "valid" | "published";

export type WorkflowWorkspaceTestInput = {
  answers?: Record<string, unknown>;
  input: unknown;
  questionResolvers?: QuestionResolverRegistry;
  runId?: string;
};

export type WorkflowWorkspaceTestResult = {
  completedAt: string;
  durationMs: number;
  error?: string;
  eventCount: number;
  input: unknown;
  runId?: string;
  startedAt: string;
  state?: unknown;
  status: string;
};

export type WorkflowWorkspacePatchProposal = {
  compiledGraph?: LoopGraphProjection;
  createdAt: string;
  document: unknown;
  id: string;
  parsedDocument?: WorkflowDocument;
  patches: WorkflowPatchRecord[];
  title?: string;
  validation: WorkflowDocumentValidation;
};

export type WorkflowWorkspacePatchProposalInput = {
  createdAt?: string;
  id?: string;
  patches: WorkflowPatchRecordInput[];
  title?: string;
};

export type WorkflowWorkspaceFrame = {
  compiledGraph?: LoopGraphProjection;
  cursor: number;
  document: unknown;
  latestPatch?: WorkflowPatchRecord;
  latestTest?: WorkflowWorkspaceTestResult;
  parsedDocument?: WorkflowDocument;
  patches: WorkflowPatchRecord[];
  proposal?: WorkflowWorkspacePatchProposal;
  publishedVersion?: string;
  status: WorkflowWorkspaceStatus;
  validation: WorkflowDocumentValidation;
  workspaceId: string;
};

export type WorkflowWorkspace<TUse = unknown> = {
  acceptProposal(): WorkflowWorkspaceFrame;
  applyPatch(input: WorkflowPatchRecordInput): WorkflowWorkspaceFrame;
  compile(): ReturnType<typeof compileWorkflowDocument<TUse>> | undefined;
  document(): unknown;
  frame(): WorkflowWorkspaceFrame;
  patches(): WorkflowPatchRecord[];
  proposePatches(input: WorkflowWorkspacePatchProposalInput): WorkflowWorkspaceFrame;
  publish(input?: { version?: string }): WorkflowWorkspaceFrame;
  rejectProposal(): WorkflowWorkspaceFrame;
  redo(): WorkflowWorkspaceFrame;
  status(): WorkflowWorkspaceStatus;
  test(input: WorkflowWorkspaceTestInput): Promise<WorkflowWorkspaceTestResult>;
  undo(): WorkflowWorkspaceFrame;
  validate(): WorkflowWorkspaceFrame;
};

export type WorkflowWorkspaceInput<TUse = unknown> = {
  catalog?: WorkflowCatalog;
  compile?: Omit<WorkflowDocumentCompileInput<TUse>, "catalog" | "document">;
  document: unknown;
  id: string;
  publishedVersion?: string;
};

export type WorkflowDocumentRenderer = {
  consume(input: AsyncIterable<WorkflowPatchRecordInput> | Iterable<WorkflowPatchRecordInput>): AsyncIterable<WorkflowWorkspaceFrame>;
  frame(): WorkflowWorkspaceFrame;
};
