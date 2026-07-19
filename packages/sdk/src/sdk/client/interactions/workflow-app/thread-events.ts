import type {
  HookRequest,
} from "../../../core/index.js";
import type {
  WorkflowAppQuestion,
  WorkflowAppRun,
  WorkflowAppRunSuspendedInteraction,
  WorkflowAppRuntimeOptions,
} from "./types.js";

export type WorkflowAppThreadEventBridge = {
  emitRunSuspended(run: WorkflowAppRun): void;
};

export function createWorkflowAppThreadEventBridge(
  options: WorkflowAppRuntimeOptions,
): WorkflowAppThreadEventBridge {
  const emittedSuspensionKeys = new Set<string>();

  return {
    emitRunSuspended(run) {
      const threadId = run.origin?.threadId;
      if (!threadId || run.status !== "waiting") return;
      if (!options.threadEvents) return;

      const interactions = suspendedInteractions(run);
      if (interactions.length === 0) return;

      const key = suspensionKey(run);
      if (!key || emittedSuspensionKeys.has(key)) return;

      options.threadEvents.emit({
        threadId,
        event: {
          interactions,
          runId: run.runId,
          type: "run.suspended",
          workflowId: run.workflowId,
        },
      });
      emittedSuspensionKeys.add(key);
    },
  };
}

function suspensionKey(run: WorkflowAppRun): string | undefined {
  const token = run.session.pendingHooks?.[0]?.token;
  const questionId = run.session.pendingQuestions[0]?.id;
  const firstInteractionId = token ?? questionId;
  return firstInteractionId ? `${run.runId}:${firstInteractionId}` : undefined;
}

function suspendedInteractions(run: WorkflowAppRun): WorkflowAppRunSuspendedInteraction[] {
  const pendingHooks = run.session.pendingHooks ?? [];
  const pendingQuestions = run.session.pendingQuestions;
  const questionIds = new Set(pendingQuestions.map((question) => question.id));
  const hookById = new Map(pendingHooks.map((hook) => [hook.id, hook]));

  return [
    ...pendingQuestions.map((question) =>
      questionInteraction(question, hookById.get(question.id))
    ),
    ...pendingHooks
      .filter((hook) => !questionIds.has(hook.id))
      .map(hookInteraction),
  ];
}

function questionInteraction(
  question: WorkflowAppQuestion,
  hook: HookRequest | undefined,
): WorkflowAppRunSuspendedInteraction {
  return {
    id: question.id,
    kind: "question",
    summary: question.prompt,
    ...(question.title ? { title: question.title } : {}),
    ...(hook?.token ? { token: hook.token } : {}),
  };
}

function hookInteraction(hook: HookRequest): WorkflowAppRunSuspendedInteraction {
  return {
    id: hook.id,
    kind: hook.kind ?? "approval",
    summary: hookSummary(hook),
    ...(hook.title ? { title: hook.title } : {}),
    token: hook.token,
  };
}

function hookSummary(hook: HookRequest): string {
  return hookInputText(hook.input) ?? hook.title ?? `Waiting for ${hook.id}.`;
}

function hookInputText(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ["summary", "message", "prompt", "title"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}
