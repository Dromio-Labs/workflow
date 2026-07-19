import type { JsonObject, JsonValue } from "./json.js";
import type { WorkflowJsonRenderDocument } from "./json-render.js";

type WorkflowTriggerInputBase = {
  description?: string;
  label?: string;
  required?: boolean;
};

export type WorkflowTriggerNoneInput = WorkflowTriggerInputBase & {
  kind: "none";
};

export type WorkflowTriggerPromptInput = WorkflowTriggerInputBase & {
  defaultValue?: string;
  kind: "prompt";
  placeholder?: string;
};

export type WorkflowTriggerJsonRenderInput = WorkflowTriggerInputBase & {
  defaultValue?: JsonValue;
  document: WorkflowJsonRenderDocument;
  jsonSchema?: JsonObject;
  kind: "json-render";
};

export type WorkflowTriggerArtifactInput = WorkflowTriggerInputBase & {
  accept?: string[];
  kind: "artifact";
  maxBytes?: number;
  multiple?: boolean;
};

export type WorkflowTriggerChoiceOption = {
  description?: string;
  label: string;
  recommended?: boolean;
  value: JsonValue;
};

export type WorkflowTriggerChoiceQuestion = {
  allowCustom?: boolean;
  description?: string;
  id: string;
  options: WorkflowTriggerChoiceOption[];
  prompt: string;
  skippable?: boolean;
};

export type WorkflowTriggerQuestionsInput = WorkflowTriggerInputBase & {
  kind: "questions";
  questions: WorkflowTriggerChoiceQuestion[];
};

export type WorkflowTriggerInputDescriptor =
  | WorkflowTriggerArtifactInput
  | WorkflowTriggerJsonRenderInput
  | WorkflowTriggerNoneInput
  | WorkflowTriggerPromptInput
  | WorkflowTriggerQuestionsInput;

export type WorkflowTriggerType =
  | "block"
  | "event"
  | "http"
  | "manual"
  | "schedule"
  | "webhook";

export type WorkflowTriggerDescriptor = {
  config?: JsonObject;
  description?: string;
  id: string;
  input: WorkflowTriggerInputDescriptor;
  label: string;
  type: WorkflowTriggerType;
};

export type WorkflowTriggerArtifactValue = {
  label: string;
  mediaType: string;
  name: string;
  path?: string;
  size?: number;
};

export type WorkflowTriggerSubmission = {
  artifacts?: WorkflowTriggerArtifactValue[];
  value?: JsonValue;
};

export function normalizeWorkflowTriggerInput(
  input?: WorkflowTriggerInputDescriptor,
): WorkflowTriggerInputDescriptor {
  if (!input) return { kind: "none", required: false };
  return { ...input, required: input.required ?? input.kind !== "none" };
}

export function workflowTriggerInputNeedsComposer(input?: WorkflowTriggerInputDescriptor): boolean {
  return normalizeWorkflowTriggerInput(input).kind !== "none";
}

export function workflowTriggerInputTerminalLines(input?: WorkflowTriggerInputDescriptor): string[] {
  const normalized = normalizeWorkflowTriggerInput(input);
  const required = normalized.required ? "required" : "optional";
  if (normalized.kind === "none") return ["Input: none"];
  if (normalized.kind === "prompt") return [`Input: prompt (${required})`];
  if (normalized.kind === "artifact") {
    const count = normalized.multiple ? "files" : "file";
    const accept = normalized.accept?.length ? ` · ${normalized.accept.join(", ")}` : "";
    return [`Input: ${count} (${required})${accept}`];
  }
  if (normalized.kind === "questions") {
    return [`Input: ${normalized.questions.length} questions (${required})`];
  }
  return [
    `Input: JSON Render (${required})`,
    `Component: ${normalized.document.component}`,
  ];
}

export function encodeWorkflowTriggerSubmission(submission: WorkflowTriggerSubmission): string {
  if (typeof submission.value === "string") return submission.value;
  if (submission.value !== undefined) return JSON.stringify(submission.value);
  if (submission.artifacts?.length) return JSON.stringify({ artifacts: submission.artifacts });
  return "";
}
