import {
  titleFromId,
  workflowAppCommands,
} from "./commands.js";
import type {
  WorkflowApp,
  WorkflowAppConfig,
  WorkflowAppEntry,
  WorkflowAppTriggerDescriptor,
} from "./types.js";
import { normalizeWorkflowTriggerInput } from "@dromio/workflow-room-protocol";

export function createWorkflowApp(input: WorkflowAppConfig | WorkflowAppEntry["workflow"]): WorkflowApp {
  const config = isWorkflow(input)
    ? {
      defaultWorkflow: "default",
      workflows: {
        default: {
          workflow: input,
        },
      },
    }
    : input;
  const entries = new Map(Object.entries(config.workflows));
  if (entries.size === 0) throw new Error("Workflow app requires at least one workflow.");
  const defaultWorkflowId = config.defaultWorkflow ?? entries.keys().next().value;
  if (!defaultWorkflowId || !entries.has(defaultWorkflowId)) {
    throw new Error(`Unknown default workflow: ${String(defaultWorkflowId)}`);
  }
  const commands = () => workflowAppCommands(entries);
  const descriptorFor = (id: string, entry: WorkflowAppEntry) => {
    const entryCommands = commands().filter((command) => command.workflowId === id);
    const triggers = workflowEntryTriggers(entry);
    return {
      ...(entryCommands.length ? { commands: entryCommands } : {}),
      configuration: entry.configuration,
      description: entry.description,
      graph: entry.workflow.graph(),
      id,
      input: entry.input ?? triggers[0]?.input,
      title: entry.title ?? titleFromId(id),
      triggers,
    };
  };

  return {
    defaultWorkflowId,
    getWorkflow(id = defaultWorkflowId) {
      const entry = entries.get(id);
      if (!entry) throw new Error(`Unknown workflow: ${id}`);
      return entry;
    },
    graph(id = defaultWorkflowId) {
      return this.getWorkflow(id).workflow.graph();
    },
    id: config.id ?? "workflow-app",
    listCommands() {
      return commands();
    },
    listWorkflows() {
      return [...entries].map(([id, entry]) => descriptorFor(id, entry));
    },
    registerWorkflow(id, entry) {
      if (!id.trim()) throw new Error("Workflow id is required.");
      entries.set(id, entry);
      return descriptorFor(id, entry);
    },
    title: config.title ?? titleFromId(config.id ?? "workflow-app"),
    workflowIds() {
      return [...entries.keys()];
    },
    workspaceFrame(id = defaultWorkflowId) {
      return this.getWorkflow(id).workspace?.frame();
    },
    modelRouter: config.modelRouter,
  };
}

function workflowEntryTriggers(entry: WorkflowAppEntry): WorkflowAppTriggerDescriptor[] {
  const declared = entry.triggers?.map((trigger) => ({
    ...trigger,
    input: normalizeWorkflowTriggerInput(trigger.input),
  }));
  if (declared?.length) {
    const ids = new Set(declared.map((trigger) => trigger.id));
    if (ids.size !== declared.length) throw new Error("Workflow trigger ids must be unique.");
    return declared;
  }
  const boundary = entry.workflow.graph().trigger;
  return [{
    id: boundary?.id ?? "$trigger",
    input: normalizeWorkflowTriggerInput(entry.input),
    label: boundary?.label ?? "Trigger",
    type: workflowTriggerType(boundary?.type),
  }];
}

function workflowTriggerType(value: unknown): WorkflowAppTriggerDescriptor["type"] {
  return value === "block" || value === "event" || value === "http" || value === "schedule" || value === "webhook"
    ? value
    : "manual";
}

export function isWorkflowApp(value: unknown): value is WorkflowApp {
  return Boolean(value && typeof value === "object" && "listWorkflows" in value && "getWorkflow" in value);
}

function isWorkflow(value: unknown): value is WorkflowAppEntry["workflow"] {
  return Boolean(value && typeof value === "object" && "start" in value && "graph" in value);
}
