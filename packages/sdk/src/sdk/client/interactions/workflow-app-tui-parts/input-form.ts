import type { TriggerDescriptor } from "../../../workflow-control-plane/index.js";
import { triggerInputJsonRender } from "../../../workflow-control-plane/index.js";
import type { WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import type { WorkflowTuiTriggerBoundarySummary } from "../workflow-app-tui.js";
import type { TuiInputForm, TuiInputFormField } from "./types.js";
import { truncate } from "./string-format.js";

export function inputDraftPreview(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "empty";
  return truncate(trimmed.replace(/\s+/g, " "), 72);
}

export function workflowStartInputForm(input: {
  prompt: string;
  summary?: WorkflowTuiTriggerBoundarySummary;
  workflow: WorkflowAppWorkflowDescriptor;
}): TuiInputForm | undefined {
  if (!input.summary) return undefined;
  const workflowPlaceholder = workflowInputPlaceholder(input.workflow);
  const jsonRenderFields = jsonRenderFormFields(triggerInputJsonRender(input.summary.publishedTrigger?.input));
  if (jsonRenderFields.length > 0) {
    const promptObject = parsePromptObject(input.prompt);
    const placeholderObject = parseJsonExampleObjectFromText(workflowPlaceholder);
    return {
      fields: jsonRenderFields.map((field) => ({
        ...field,
        placeholder: stringValue(placeholderObject[field.name]) ?? field.placeholder,
        value: tuiFormValue(promptObject[field.name] ?? field.defaultValue, field.valueType),
      })),
      kind: "json",
      title: `${input.workflow.title} input fields`,
    };
  }
  if (triggerInputIsSingleText(input.summary)) {
    const name = input.summary.inputKeys[0] ?? "input";
    return {
      fields: [{
        label: titleFromIdentifier(name),
        name,
        placeholder: workflowPlaceholder,
        type: "textarea",
        value: input.prompt,
      }],
      kind: "text",
      title: `${input.workflow.title} input`,
    };
  }
  if (input.summary.inputKeys.length === 1) {
    return {
      fields: [{
        label: titleFromIdentifier(input.summary.inputKeys[0]!),
        name: input.summary.inputKeys[0]!,
        placeholder: workflowPlaceholder,
        type: "textarea",
        value: input.prompt,
      }],
      kind: "text",
      title: `${input.workflow.title} input`,
    };
  }
  return undefined;
}

export function triggerInputIsSingleText(summary: WorkflowTuiTriggerBoundarySummary) {
  if (summary.inputKeys.length !== 1 || summary.inputSchemas.length !== 1) return false;
  const schema = summary.inputSchemas[0] ?? "";
  return schema.includes(": string") && !schema.includes("anyOf") && !schema.includes("oneOf");
}

export function jsonRenderFormFields(value: unknown): Array<Omit<TuiInputFormField, "value">> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const fields = (value as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field): Array<Omit<TuiInputFormField, "value">> => {
    if (!field || typeof field !== "object" || Array.isArray(field)) return [];
    const record = field as {
      defaultValue?: unknown;
      label?: unknown;
      name?: unknown;
      placeholder?: unknown;
      required?: unknown;
      type?: unknown;
      valueType?: unknown;
    };
    if (typeof record.name !== "string" || !record.name) return [];
    const type = record.type === "checkbox"
      ? "checkbox"
      : record.type === "number" ? "number" : record.type === "textarea" ? "textarea" : "text";
    return [{
      defaultValue: record.defaultValue,
      label: typeof record.label === "string" ? record.label : titleFromIdentifier(record.name),
      name: record.name,
      placeholder: stringValue(record.placeholder),
      required: record.required === true,
      type,
      valueType: jsonRenderValueType(record.valueType),
    }];
  });
}

export function inputFormHeaderLine() {
  return `  ${inputFormCell("FIELD", 14)} ${inputFormCell("LABEL", 24)} ${inputFormCell("TYPE", 9)} VALUE`;
}

export function formFieldStructuredLine(field: TuiInputFormField, selected: boolean) {
  return `${formFieldStructuredPrefix(field, selected)}${formFieldValue(field)}`;
}

export function formFieldStructuredPrefix(field: TuiInputFormField, selected: boolean) {
  return [
    selected ? ">" : " ",
    inputFormCell(field.name, 14),
    inputFormCell(field.label, 24),
    inputFormCell(field.type, 9),
    "",
  ].join(" ");
}

export function inputFormCell(value: string, width: number) {
  const compact = value.replace(/\s+/g, " ");
  const clipped = compact.length > width ? `${compact.slice(0, Math.max(0, width - 3))}...` : compact;
  return clipped.padEnd(width, " ");
}

export function formFieldValue(field: TuiInputFormField) {
  if (field.type === "checkbox") {
    const current = field.value ? "[x]" : "[ ]";
    return field.value === undefined && field.placeholder ? `${current} example ${field.placeholder}` : current;
  }
  const value = typeof field.value === "string" && field.value ? field.value : "";
  if (value) return value;
  return field.placeholder ? `example ${field.placeholder}` : "empty";
}

export function formFieldEditableValue(field?: TuiInputFormField) {
  if (!field || field.type === "checkbox") return "";
  return typeof field.value === "string" ? field.value : "";
}

export function formFieldCursorEnd(field?: TuiInputFormField) {
  return formFieldEditableValue(field).length;
}

export function renderedJsonFormPrompt(form: TuiInputForm, prompt: string) {
  const object = parsePromptObject(prompt);
  for (const field of form.fields) {
    if ((field.type === "number" || field.valueType === "number") && typeof field.value === "string" && field.value.trim()) {
      const parsed = Number(field.value.trim());
      object[field.name] = Number.isFinite(parsed) ? parsed : field.value;
      continue;
    }
    if (field.valueType === "json" && typeof field.value === "string" && field.value.trim()) {
      object[field.name] = JSON.parse(field.value);
      continue;
    }
    if (field.value !== undefined) object[field.name] = field.value;
  }
  return JSON.stringify(object);
}

export function renderedJsonFormValidation(
  form: TuiInputForm,
  prompt: string,
): { fieldIndex: number; message: string } | undefined {
  const object = parsePromptObject(prompt);
  for (const [fieldIndex, field] of form.fields.entries()) {
    const value = Object.hasOwn(object, field.name) ? object[field.name] : field.defaultValue;
    if (field.required && inputFormValueMissing(value, field.type)) {
      return {
        fieldIndex,
        message: `${field.label} is required.`,
      };
    }
    if (inputFormValueMissing(value, field.type)) continue;
    const valueError = inputFormValueTypeError(value, field);
    if (valueError) return { fieldIndex, message: valueError };
  }
  return undefined;
}

export function inputFormValueMissing(value: unknown, type: TuiInputFormField["type"]) {
  if (value === undefined || value === null) return true;
  if (type === "checkbox") return typeof value !== "boolean";
  if (typeof value === "string") return value.trim() === "";
  return false;
}

export function inputFormValueTypeError(value: unknown, field: TuiInputFormField) {
  if ((field.type === "number" || field.valueType === "number") && typeof value === "string" && value.trim()) {
    return Number.isFinite(Number(value.trim())) ? undefined : `${field.label} must be a number.`;
  }
  if (field.valueType === "json" && typeof value === "string" && value.trim()) {
    try {
      JSON.parse(value);
      return undefined;
    } catch {
      return `${field.label} must be valid JSON.`;
    }
  }
  return undefined;
}

export function parseJsonExampleObjectFromText(value?: string): Record<string, unknown> {
  const json = extractJsonObjectFromText(value);
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function stringValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export function tuiFormValue(value: unknown, valueType?: TuiInputFormField["valueType"]): boolean | string | undefined {
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (valueType === "json" && value !== undefined) return JSON.stringify(value);
  return undefined;
}

export function jsonRenderValueType(value: unknown): TuiInputFormField["valueType"] {
  return value === "boolean" || value === "json" || value === "number" || value === "string"
    ? value
    : undefined;
}

export function titleFromIdentifier(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function triggerInputExampleLines(
  workflow: WorkflowAppWorkflowDescriptor,
  summary: WorkflowTuiTriggerBoundarySummary,
) {
  const fromPlaceholder = jsonExampleLinesFromText(workflowInputPlaceholder(workflow));
  if (fromPlaceholder.length > 0) return fromPlaceholder;
  const published = publishedInputExampleLines(summary);
  if (published.length > 0 && published[0] !== "-") return published;
  return summary.inputSchemaLines;
}

export function workflowInputPlaceholder(workflow: WorkflowAppWorkflowDescriptor) {
  return workflow.input?.kind === "prompt" ? workflow.input.placeholder : undefined;
}

export function publishedInputExampleLines(summary: WorkflowTuiTriggerBoundarySummary) {
  if (!summary.publishedTrigger) return ["-"];
  return defaultTriggerInputText(summary.publishedTrigger).split("\n");
}

export function jsonExampleLinesFromText(value?: string) {
  const json = extractJsonObjectFromText(value);
  if (!json) return [];
  try {
    return JSON.stringify(JSON.parse(json), null, 2).split("\n");
  } catch {
    return json.split("\n");
  }
}

export function extractJsonObjectFromText(value?: string) {
  if (!value) return undefined;
  const start = value.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return value.slice(start, index + 1);
  }
  return undefined;
}

export function parsePromptObject(prompt: string): Record<string, unknown> {
  const trimmed = prompt.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return { path: trimmed };
}

export function triggerInputFields(trigger: TriggerDescriptor): string[] {
  const fields = jsonRenderFields(triggerInputJsonRender(trigger.input));
  if (fields.length > 0) return fields;
  const schema = trigger.input?.jsonSchema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return ["body: JSON"];
  const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {};
  const required = new Set((schema as { required?: unknown }).required as string[] | undefined ?? []);
  const entries = Object.entries(properties);
  if (entries.length === 0) return ["body: JSON"];
  return entries.map(([name, value]) => {
    const type = value && typeof value === "object" && !Array.isArray(value)
      ? String((value as { type?: unknown }).type ?? "unknown")
      : "unknown";
    return `${required.has(name) ? "*" : " "} ${name}: ${type}`;
  });
}

export function jsonRenderFields(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const fields = (value as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field): string[] => {
    if (!field || typeof field !== "object" || Array.isArray(field)) return [];
    const record = field as { label?: unknown; name?: unknown; type?: unknown };
    const name = typeof record.name === "string" ? record.name : undefined;
    if (!name) return [];
    const label = typeof record.label === "string" ? record.label : name;
    const type = typeof record.type === "string" ? record.type : "field";
    return [`${name}: ${type} · ${label}`];
  });
}

export function defaultTriggerInputText(trigger: TriggerDescriptor) {
  const schema = trigger.input?.jsonSchema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return "{}";
  const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {};
  const required = new Set((schema as { required?: unknown }).required as string[] | undefined ?? []);
  const value: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(properties)) {
    if (!required.has(name)) continue;
    const type = property && typeof property === "object" && !Array.isArray(property)
      ? (property as { type?: unknown }).type
      : undefined;
    value[name] = type === "boolean" ? false : type === "number" || type === "integer" ? 0 : "";
  }
  return JSON.stringify(value, null, 2);
}
