import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  TriggerDescriptor,
  TriggerRegistryDocument,
  TriggerRegistryStore,
} from "./types.js";
import type {
  WorkflowApp,
} from "../client/interactions/workflow-app.js";

export function createJsonTriggerStore(filePath: string): TriggerRegistryStore {
  return {
    async read() {
      if (!existsSync(filePath)) return { version: 1, triggers: [] };
      const document = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      return normalizeTriggerRegistryDocument(document);
    },
    async write(document) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(normalizeTriggerRegistryDocument(document), null, 2)}\n`);
    },
  };
}

export async function syncWorkflowTriggers(
  app: WorkflowApp,
  store: TriggerRegistryStore,
): Promise<TriggerRegistryDocument> {
  const document = await store.read();
  const triggers = new Map(document.triggers.map((trigger) => [trigger.id, trigger]));
  for (const workflow of app.listWorkflows()) {
    const id = `${workflow.id}.http`;
    if (triggers.has(id)) continue;
    triggers.set(id, {
      auth: {
        mode: "bearer",
        tokenRef: `trigger:${id}`,
      },
      config: {
        method: "POST",
        path: `/api/triggers/${id}`,
      },
      description: workflow.description,
      enabled: false,
      id,
      input: {
        contentType: "application/json",
        mode: "body",
      },
      label: workflow.title,
      source: {
        triggerId: "http",
      },
      type: "http",
      workflowId: workflow.id,
    });
  }
  const next = {
    version: 1,
    triggers: [...triggers.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
  await store.write?.(next);
  return next;
}

export function normalizeTriggerRegistryDocument(value: unknown): TriggerRegistryDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Trigger registry must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const triggers = Array.isArray(record.triggers) ? record.triggers.map(normalizeTrigger) : [];
  return {
    triggers,
    version: typeof record.version === "number" ? record.version : 1,
  };
}

function normalizeTrigger(value: unknown): TriggerDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Trigger registry entries must be objects.");
  }
  const record = value as Record<string, unknown>;
  const id = requiredString(record.id, "trigger.id");
  const workflowId = requiredString(record.workflowId, `trigger ${id}.workflowId`);
  return {
    auth: normalizeAuth(record.auth),
    config: objectOrUndefined(record.config) as TriggerDescriptor["config"],
    description: stringOrUndefined(record.description),
    enabled: record.enabled !== false,
    id,
    input: normalizeInput(record.input),
    label: stringOrUndefined(record.label) ?? titleFromId(id),
    source: objectOrUndefined(record.source) as TriggerDescriptor["source"],
    type: normalizeTriggerType(record.type),
    workflowId,
  };
}

function normalizeAuth(value: unknown): TriggerDescriptor["auth"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const mode = record.mode === "none" ? "none" : "bearer";
  return {
    mode,
    tokenRef: stringOrUndefined(record.tokenRef),
  };
}

function normalizeInput(value: unknown): TriggerDescriptor["input"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    contentType: stringOrUndefined(record.contentType),
    jsonRender: record.jsonRender,
    jsonSchema: record.jsonSchema,
    mode: record.mode === "envelope" ? "envelope" : "body",
  };
}

function normalizeTriggerType(value: unknown): TriggerDescriptor["type"] {
  if (
    value === "block" ||
    value === "event" ||
    value === "http" ||
    value === "manual" ||
    value === "schedule" ||
    value === "webhook"
  ) {
    return value;
  }
  return "http";
}

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`Missing ${field}.`);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function titleFromId(value: string) {
  return value.replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
