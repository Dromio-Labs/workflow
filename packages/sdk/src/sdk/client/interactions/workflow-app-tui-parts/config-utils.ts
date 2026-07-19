import { type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { type WorkflowMetadataSelectionRow } from "./artifact-step-pages.js";
import { parsePromptObject } from "./input-form.js";
import { truncate } from "./string-format.js";
import { THEME } from "./style.js";
import { type ExternalEditorTarget, type WorkflowConfigField } from "./types.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

export function workflowConfigurationEditPrompt(
  workflow: WorkflowAppWorkflowDescriptor,
  currentPrompt: string,
) {
  const configuration = workflow.configuration;
  if (!configuration || configuration.fields.length === 0) return "";
  const template = configuration.editTemplate ?? workflowConfigurationTemplate(configuration.fields);
  const current = parsePromptObject(currentPrompt);
  return `${JSON.stringify({
    ...template,
    ...current,
  }, null, 2)}\n`;
}

export function workflowConfigurationTemplate(
  fields: NonNullable<WorkflowAppWorkflowDescriptor["configuration"]>["fields"],
) {
  const template: Record<string, unknown> = {};
  for (const field of fields) {
    const key = field.inputKey ?? field.id;
    if (field.value !== undefined) template[key] = field.value;
  }
  return template;
}

export function metadataRowExternalEditorTarget(
  row: WorkflowMetadataSelectionRow | undefined,
  workflow: WorkflowAppWorkflowDescriptor,
  inputDraft: string,
  configOverrides: Record<string, unknown>,
): ExternalEditorTarget | undefined {
  if (row?.kind === "file" && row.path) {
    return {
      filePath: row.path,
      kind: "file",
      title: `Open ${path.basename(row.path)} in External Editor`,
    };
  }
  if (row?.kind === "config") {
    const key = row.field.inputKey ?? row.field.id;
    if (key === "configPath") {
      const value = workflowConfigFieldEffectiveValue(row.field, parsePromptObject(inputDraft), configOverrides);
      if (typeof value === "string" && value.trim()) {
        return {
          create: true,
          defaultContent: "{}\n",
          filePath: value,
          kind: "config",
          title: `Open ${path.basename(value)} in External Editor`,
          workflowId: workflow.id,
        };
      }
    }
    return workflowConfigExternalEditorTarget(workflow, inputDraft, configOverrides);
  }
  return undefined;
}

export function workflowConfigExternalEditorTarget(
  workflow: WorkflowAppWorkflowDescriptor,
  inputDraft: string,
  configOverrides: Record<string, unknown>,
): ExternalEditorTarget | undefined {
  const configPathField = workflow.configuration?.fields.find((field) => (field.inputKey ?? field.id) === "configPath");
  const configPath = configPathField
    ? workflowConfigFieldEffectiveValue(configPathField, parsePromptObject(inputDraft), configOverrides)
    : workflow.configuration?.configPath;
  if (typeof configPath !== "string" || !configPath.trim()) return undefined;
  return {
    create: true,
    defaultContent: "{}\n",
    filePath: configPath,
    kind: "config",
    title: `Open ${workflow.title} Config in External Editor`,
    workflowId: workflow.id,
  };
}

export function workflowConfigFieldMissing(
  field: NonNullable<WorkflowAppWorkflowDescriptor["configuration"]>["fields"][number],
) {
  return field.required === true && (field.value === undefined || field.value === "");
}

export function workflowConfigFieldLine(
  field: NonNullable<WorkflowAppWorkflowDescriptor["configuration"]>["fields"][number],
  maxLength: number,
) {
  const env = Array.isArray(field.env) ? field.env.join("|") : field.env;
  const key = field.inputKey ?? field.id;
  const sourceValue = workflowConfigFieldSource(field);
  const source = sourceValue !== "-" ? ` ${sourceValue}` : "";
  const value = workflowConfigFieldValue(field);
  return truncate(`${field.label ?? field.id}: ${value}${source} (${env ?? key})`, maxLength);
}

export function workflowConfigFieldValue(
  field: WorkflowConfigField,
) {
  if (field.value === undefined || field.value === "") {
    return workflowConfigFieldMissing(field) ? "<missing>" : "not set";
  }
  return String(field.value);
}

export function workflowConfigFieldSource(
  field: WorkflowConfigField,
) {
  if ((field.value === undefined || field.value === "") && field.source === "missing" && field.required !== true) {
    return "optional";
  }
  return field.source ?? "-";
}

export function workflowConfigFieldVia(
  field: WorkflowConfigField,
) {
  const key = field.inputKey ?? field.id;
  if (field.env === undefined) return key;
  return typeof field.env === "string" ? field.env : field.env.join("|");
}

export function workflowConfigFieldDisplay(
  field: WorkflowConfigField,
  draft: Record<string, unknown>,
  configOverrides: Record<string, unknown>,
) {
  const key = field.inputKey ?? field.id;
  const value = workflowConfigFieldEffectiveValue(field, draft, configOverrides);
  const hasDraftValue = Object.prototype.hasOwnProperty.call(draft, key);
  const hasConfigOverride = Object.prototype.hasOwnProperty.call(configOverrides, key);
  return {
    source: hasDraftValue ? "request" : hasConfigOverride ? "config" : workflowConfigFieldSource(field),
    value: value === undefined || value === ""
      ? workflowConfigFieldMissing(field) ? "<missing>" : "not set"
      : String(value),
  };
}

export function workflowConfigFieldEffectiveValue(
  field: WorkflowConfigField,
  draft: Record<string, unknown>,
  configOverrides: Record<string, unknown> = {},
) {
  const key = field.inputKey ?? field.id;
  if (Object.prototype.hasOwnProperty.call(draft, key)) return draft[key];
  if (Object.prototype.hasOwnProperty.call(configOverrides, key)) return configOverrides[key];
  return field.value;
}

export function workflowConfigValueFromDraft(field: WorkflowConfigField, draft: string) {
  const trimmed = draft.trim();
  if (field.type === "number") {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${field.label ?? field.id} must be a number.`);
    }
    return parsed;
  }
  if (field.type === "boolean") {
    if (/^(true|1|yes|on)$/i.test(trimmed)) return true;
    if (/^(false|0|no|off)$/i.test(trimmed)) return false;
    throw new Error(`${field.label ?? field.id} must be true or false.`);
  }
  return draft;
}

export function workflowPromptWithConfigValue(prompt: string, key: string, value: unknown) {
  return `${JSON.stringify({
    ...parsePromptObject(prompt),
    [key]: value,
  }, null, 2)}\n`;
}

export function workflowPromptWithoutConfigValue(prompt: string, key: string) {
  const next = parsePromptObject(prompt);
  delete next[key];
  return Object.keys(next).length > 0 ? `${JSON.stringify(next, null, 2)}\n` : "";
}

export function writeWorkflowConfigValue(configPath: string, key: string, value: unknown) {
  const filePath = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
  let parsed: unknown = {};
  if (existsSync(filePath)) {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config file must contain a JSON object: ${configPath}`);
  }
  writeFileSync(filePath, `${JSON.stringify({
    ...(parsed as Record<string, unknown>),
    [key]: value,
  }, null, 2)}\n`);
}

export function wrappedValueLines(value: string, width: number, maxLines: number) {
  const chunks = value.split("\n").flatMap((line) => wrapLine(line, width));
  if (chunks.length <= maxLines) return chunks;
  return [
    ...chunks.slice(0, Math.max(0, maxLines - 1)),
    truncate(chunks.slice(maxLines - 1).join(" "), width),
  ];
}

export function wrapLine(line: string, width: number) {
  if (line.length === 0) return [" "];
  const result: string[] = [];
  for (let index = 0; index < line.length; index += width) {
    result.push(line.slice(index, index + width));
  }
  return result;
}

export function workflowConfigSourceColor(source: string) {
  if (source === "missing") return THEME.warning;
  if (source === "default") return THEME.muted;
  if (source === "optional") return THEME.muted;
  if (source === "env" || source === "request") return THEME.accent;
  return THEME.info;
}
