import type {
  NormalizedCliArgs,
  WorkflowApp,
  WorkflowAppCommandDescriptor,
  WorkflowAppEntry,
  WorkflowAppResolvedStartInput,
} from "./types.js";

export function resolveWorkflowAppStartInput(
  app: WorkflowApp,
  input: {
    input: string;
    triggerId?: string;
    workflowId?: string;
  },
): WorkflowAppResolvedStartInput {
  const command = matchWorkflowAppCommand(app.listCommands(), input.input);
  if (command) {
    const triggerId = resolveTriggerId(app, command.workflowId, input.triggerId);
    return {
      command,
      input: input.input,
      triggerId,
      workflowId: command.workflowId,
    };
  }
  const workflowId = input.workflowId ?? app.defaultWorkflowId;
  return {
    input: input.input,
    triggerId: resolveTriggerId(app, workflowId, input.triggerId),
    workflowId,
  };
}

function resolveTriggerId(app: WorkflowApp, workflowId: string, requested?: string) {
  const workflow = app.listWorkflows().find((item) => item.id === workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  const triggerId = requested ?? workflow.triggers[0]?.id;
  if (!triggerId || !workflow.triggers.some((trigger) => trigger.id === triggerId)) {
    throw new Error(`Unknown trigger ${String(triggerId)} for workflow ${workflowId}.`);
  }
  return triggerId;
}

export function parseWorkflowCliArgs(app: WorkflowApp, argv: string[]): NormalizedCliArgs {
  const positional: string[] = [];
  let interactive: boolean | undefined;
  let sessionId: string | undefined;
  let workflowId: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--cli") continue;
    if (arg === "--interactive" || arg === "-i") {
      interactive = true;
      continue;
    }
    if (arg === "--non-interactive") {
      interactive = false;
      continue;
    }
    if (arg === "--workflow" || arg === "-w") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        return { error: `Missing workflow id after ${arg}.`, interactive, prompt: positional.join(" ").trim(), workflowId };
      }
      workflowId = value;
      index += 1;
      continue;
    }
    if (arg === "--session" || arg === "-s") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        return { error: `Missing session id after ${arg}.`, interactive, prompt: positional.join(" ").trim(), workflowId };
      }
      sessionId = value;
      index += 1;
      continue;
    }
    if (arg === "--prompt" || arg === "-p") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    positional.push(arg);
  }
  if (!workflowId && positional[0] && app.workflowIds().includes(positional[0])) {
    workflowId = positional.shift();
  }
  return {
    interactive,
    prompt: positional.join(" ").trim(),
    ...(sessionId ? { sessionId } : {}),
    workflowId,
  };
}

export function formatUnknownWorkflowMessage(app: WorkflowApp, workflowId: string) {
  return `Unknown workflow: ${workflowId}\nAvailable workflows: ${app.workflowIds().join(", ")}\n`;
}

export function workflowAppCommands(entries: Map<string, WorkflowAppEntry>): WorkflowAppCommandDescriptor[] {
  const commands: WorkflowAppCommandDescriptor[] = [];
  const seen = new Set<string>();
  for (const [workflowId, entry] of entries) {
    for (const command of entry.commands ?? []) {
      const name = normalizeWorkflowAppCommandName(command.name);
      if (!name) throw new Error(`Workflow ${workflowId} declares an empty command name.`);
      if (seen.has(name)) throw new Error(`Duplicate workflow command /${name}.`);
      seen.add(name);
      commands.push({
        ...command,
        name,
        workflowId,
      });
    }
  }
  return commands;
}

export function titleFromId(value: string) {
  return value.replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function matchWorkflowAppCommand(
  commands: WorkflowAppCommandDescriptor[],
  input: string,
): WorkflowAppCommandDescriptor | undefined {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return undefined;
  for (const command of commands) {
    const prefix = `/${command.name}`;
    if (!trimmed.startsWith(prefix)) continue;
    const next = trimmed.at(prefix.length);
    if (next === undefined || /\s/.test(next)) return command;
  }
  return undefined;
}

function normalizeWorkflowAppCommandName(name: string) {
  return name.trim().replace(/^\/+/, "").toLowerCase();
}
