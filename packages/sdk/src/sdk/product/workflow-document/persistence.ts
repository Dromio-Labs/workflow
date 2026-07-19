import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workflowDocumentSchema } from "./schema.js";
import type {
  WorkflowWorkspaceFrame,
} from "./workspace.js";

export type PersistWorkflowWorkspaceInput = {
  directory: string | URL;
  frame: WorkflowWorkspaceFrame;
};

export type PublishWorkflowWorkspaceInput = {
  directory: string | URL;
  frame: WorkflowWorkspaceFrame;
  workflowId?: string;
};

export async function persistWorkflowWorkspaceFrame(input: PersistWorkflowWorkspaceInput) {
  const directory = resolvePath(input.directory);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "workspace.json"),
    `${JSON.stringify({
      document: input.frame.document,
      proposal: input.frame.proposal,
      publishedVersion: input.frame.publishedVersion,
      status: input.frame.status,
      validation: input.frame.validation,
      workspaceId: input.frame.workspaceId,
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(directory, "patches.jsonl"),
    input.frame.patches.map((patch) => JSON.stringify(patch)).join("\n") +
      (input.frame.patches.length > 0 ? "\n" : ""),
  );
  await writeFile(
    path.join(directory, "validation.json"),
    `${JSON.stringify(input.frame.validation, null, 2)}\n`,
  );
}

export async function publishWorkflowWorkspaceFrame(input: PublishWorkflowWorkspaceInput) {
  if (input.frame.proposal) {
    throw new Error(`Accept or reject proposed workflow patches before publishing workspace ${input.frame.workspaceId}.`);
  }
  if (!input.frame.validation.ok) {
    throw new Error(`Cannot publish invalid workflow workspace ${input.frame.workspaceId}.`);
  }
  const document = workflowDocumentSchema.parse(input.frame.document);
  const workflowId = input.workflowId ?? document.id;
  const directory = resolvePath(input.directory);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${workflowId}.workflow.json`),
    `${JSON.stringify(document, null, 2)}\n`,
  );
}

function resolvePath(value: string | URL) {
  return value instanceof URL ? fileURLToPath(value) : value;
}
