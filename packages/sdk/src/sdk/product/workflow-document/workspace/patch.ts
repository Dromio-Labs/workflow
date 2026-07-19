import { z } from "zod";
import type {
  WorkflowDocumentValidation,
  WorkflowDocumentValidationIssue,
} from "../editor.js";
import {
  cloneJson,
  isRecord,
  jsonEqual,
} from "./json.js";

export const workflowPatchOperationSchema = z.object({
  from: z.string().optional(),
  op: z.enum(["add", "remove", "replace", "move", "copy", "test"]),
  path: z.string(),
  value: z.unknown().optional(),
}).superRefine((value, context) => {
  if ((value.op === "move" || value.op === "copy") && !value.from) {
    context.addIssue({
      code: "custom",
      message: `${value.op} patches require from.`,
      path: ["from"],
    });
  }
  if ((value.op === "add" || value.op === "replace" || value.op === "test") && !Object.hasOwn(value, "value")) {
    context.addIssue({
      code: "custom",
      message: `${value.op} patches require value.`,
      path: ["value"],
    });
  }
});

export const workflowPatchRecordSchema = z.object({
  createdAt: z.string().trim().min(1),
  id: z.string().trim().min(1),
  patch: workflowPatchOperationSchema,
  scope: z.object({
    nodeId: z.string().trim().min(1).optional(),
    phase: z.string().trim().min(1).optional(),
  }).optional(),
  source: z.enum(["human", "llm", "system"]),
  target: z.literal("document"),
  validationAfter: z.object({
    issues: z.array(z.object({
      code: z.string(),
      message: z.string(),
      path: z.string().optional(),
      severity: z.enum(["error", "warning"]),
    })),
    ok: z.boolean(),
  }).optional(),
});

export type WorkflowPatchOperation = z.infer<typeof workflowPatchOperationSchema>;
export type WorkflowPatchRecord = z.infer<typeof workflowPatchRecordSchema>;
export type WorkflowPatchRecordInput = Omit<WorkflowPatchRecord, "createdAt" | "id" | "validationAfter"> & {
  createdAt?: string;
  id?: string;
  validationAfter?: WorkflowDocumentValidation;
};

let patchCounter = 0;

export function normalizeWorkflowPatchRecord(input: WorkflowPatchRecordInput): WorkflowPatchRecord {
  return workflowPatchRecordSchema.parse({
    ...input,
    createdAt: input.createdAt ?? new Date().toISOString(),
    id: input.id ?? `workflow-patch-${Date.now()}-${++patchCounter}`,
  });
}

export function applyWorkflowPatchOperation(rootInput: unknown, patch: WorkflowPatchOperation): unknown {
  let root = cloneJson(rootInput);
  switch (patch.op) {
    case "add":
      root = setPointerValue(root, patch.path, patch.value, { insert: true, requireExisting: false });
      return root;
    case "remove":
      root = removePointerValue(root, patch.path);
      return root;
    case "replace":
      root = setPointerValue(root, patch.path, patch.value, { insert: false, requireExisting: true });
      return root;
    case "copy": {
      const value = getPointerValue(root, patch.from!);
      root = setPointerValue(root, patch.path, cloneJson(value), { insert: true, requireExisting: false });
      return root;
    }
    case "move": {
      const value = getPointerValue(root, patch.from!);
      root = removePointerValue(root, patch.from!);
      root = setPointerValue(root, patch.path, value, { insert: true, requireExisting: false });
      return root;
    }
    case "test": {
      const value = getPointerValue(root, patch.path);
      if (!jsonEqual(value, patch.value)) {
        throw new Error(`Patch test failed at ${patch.path}.`);
      }
      return root;
    }
  }
}

export function patchApplyIssue(
  record: Pick<WorkflowPatchRecord, "id" | "patch">,
  error: unknown,
): WorkflowDocumentValidationIssue {
  return {
    code: "patch.apply",
    message: error instanceof Error ? error.message : `Patch ${record.id} failed to apply.`,
    path: record.patch.path,
    severity: "error",
  };
}

function getPointerValue(root: unknown, path: string): unknown {
  const segments = parseJsonPointer(path);
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = parseArrayIndex(segment, current.length - 1, path);
      current = current[index];
      continue;
    }
    if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
      continue;
    }
    throw new Error(`Patch path ${path} does not exist.`);
  }
  return current;
}

function setPointerValue(
  root: unknown,
  path: string,
  value: unknown,
  options: { insert: boolean; requireExisting: boolean },
): unknown {
  const segments = parseJsonPointer(path);
  if (segments.length === 0) return cloneJson(value);
  const { parent, token } = pointerParent(root, segments, path);
  if (Array.isArray(parent)) {
    if (token === "-") {
      parent.push(cloneJson(value));
      return root;
    }
    const max = options.insert ? parent.length : parent.length - 1;
    const index = parseArrayIndex(token, max, path);
    if (options.requireExisting && index >= parent.length) {
      throw new Error(`Patch path ${path} does not exist.`);
    }
    if (options.insert) {
      parent.splice(index, 0, cloneJson(value));
    } else {
      parent[index] = cloneJson(value);
    }
    return root;
  }
  if (!isRecord(parent)) {
    throw new Error(`Patch parent for ${path} is not an object or array.`);
  }
  if (options.requireExisting && !Object.hasOwn(parent, token)) {
    throw new Error(`Patch path ${path} does not exist.`);
  }
  parent[token] = cloneJson(value);
  return root;
}

function removePointerValue(root: unknown, path: string): unknown {
  const segments = parseJsonPointer(path);
  if (segments.length === 0) return undefined;
  const { parent, token } = pointerParent(root, segments, path);
  if (Array.isArray(parent)) {
    const index = parseArrayIndex(token, parent.length - 1, path);
    parent.splice(index, 1);
    return root;
  }
  if (!isRecord(parent) || !Object.hasOwn(parent, token)) {
    throw new Error(`Patch path ${path} does not exist.`);
  }
  delete parent[token];
  return root;
}

function pointerParent(root: unknown, segments: string[], path: string): { parent: unknown; token: string } {
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(parent)) {
      const index = parseArrayIndex(segment, parent.length - 1, path);
      parent = parent[index];
      continue;
    }
    if (isRecord(parent) && Object.hasOwn(parent, segment)) {
      parent = parent[segment];
      continue;
    }
    throw new Error(`Patch parent for ${path} does not exist.`);
  }
  return {
    parent,
    token: segments.at(-1)!,
  };
}

function parseJsonPointer(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) {
    throw new Error(`Patch path ${path} must be a JSON pointer.`);
  }
  return path.slice(1).split("/").map((segment) => segment
    .replaceAll("~1", "/")
    .replaceAll("~0", "~"));
}

function parseArrayIndex(value: string, max: number, path: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Patch path ${path} uses an invalid array index.`);
  }
  const index = Number(value);
  if (index < 0 || index > max) {
    throw new Error(`Patch path ${path} array index is out of bounds.`);
  }
  return index;
}
