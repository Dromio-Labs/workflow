import type {
  EventPayload,
  EventRecord,
} from "../loop/index.js";
import { normalizeActions, actionDescriptor } from "./actions.js";
import { eventStreamFromList } from "./events.js";
import {
  runRuntimeEffect,
  runtimeOperationEffect,
} from "./effects.js";
import { RuntimeSessionStore } from "./store.js";
import {
  cloneSnapshot,
  controlFromStartable,
  snapshotFromStartable,
} from "./sessions.js";
import type {
  CreateIntentRuntimeInput,
  IntentRuntime,
  RuntimeAction,
  RuntimeApplyActionInput,
  RuntimeAuthz,
  RuntimeAuthzInput,
  RuntimeEventStreamOptions,
  RuntimeRerunInput,
  RuntimeSessionControl,
  RuntimeSessionSnapshot,
  RuntimeStartOptions,
  RuntimeStartable,
  RuntimeStartableSession,
  RuntimeWorkflow,
  RuntimeWorkflowDescriptor,
} from "./runtime.types.js";

type RegisteredRuntimeWorkflow = (RuntimeWorkflow | RuntimeStartable) & { key: string };

export function createIntentRuntime(input: CreateIntentRuntimeInput): IntentRuntime {
  const workflows = normalizeWorkflows(input.workflows);
  const actions = normalizeActions(input.actions);
  const sessions = new RuntimeSessionStore();
  addDefaultActions(actions, sessions);
  const authz = input.authz;

  const runtime: IntentRuntime = {
    async applyAction(actionInput: RuntimeApplyActionInput) {
      const session = await runtime.getSession(actionInput.sessionId, { actor: actionInput.actor });
      const action = actions.get(actionInput.actionKey);
      if (!action) {
        return rejectedAction(actionInput.actionKey, "UNKNOWN_ACTION", `Unknown action: ${actionInput.actionKey}`);
      }
      await authorize(authz, {
        actor: actionInput.actor,
        operation: `action:${actionInput.actionKey}`,
        target: { id: actionInput.sessionId, kind: "action" },
      });
      const context = {
        actor: actionInput.actor,
        input: actionInput.input,
        runtime,
        session,
      };
      const availability = action.available ? await action.available(context) : { status: "available" as const };
      if (availability.status !== "available") {
        return rejectedAction(actionInput.actionKey, "ACTION_UNAVAILABLE", availability.reason ?? "Action is unavailable.");
      }
      return action.run(context);
    },

    async cancelSession(sessionId, cancelInput = {}) {
      await authorize(authz, {
        actor: cancelInput.actor,
        operation: "session.cancel",
        target: { id: sessionId, kind: "session" },
      });
      const control = requireControl(sessions, sessionId, "cancel");
      if (!control.cancel) throw new Error(`Session ${sessionId} does not support cancellation.`);
      return control.cancel({ reason: cancelInput.reason });
    },

    async getSession(sessionId, getInput = {}) {
      await authorize(authz, {
        actor: getInput.actor,
        operation: "session.read",
        target: { id: sessionId, kind: "session" },
      });
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`Unknown session: ${sessionId}`);
      return session;
    },

    async listActions(sessionId, listInput = {}) {
      const session = await runtime.getSession(sessionId, listInput);
      return Promise.all([...actions.values()].map((action) =>
        actionDescriptor(action, {
          actor: listInput.actor,
          runtime,
          session,
        })
      ));
    },

    async listCheckpoints(sessionId, listInput = {}) {
      const session = await runtime.getSession(sessionId, listInput);
      return cloneSnapshot(session.checkpoints);
    },

    async listEvents(sessionId, listInput = {}) {
      const session = await runtime.getSession(sessionId, listInput);
      return session.events.filter((event) =>
        listInput.fromIndex === undefined || event.index >= listInput.fromIndex
      );
    },

    async listSessions(listInput = {}) {
      await authorize(authz, {
        actor: listInput.actor,
        operation: "session.list",
        target: { kind: "session" },
      });
      return sessions.list();
    },

    async listWorkflows(listInput = {}) {
      await authorize(authz, {
        actor: listInput.actor,
        operation: "workflow.list",
        target: { kind: "workflow" },
      });
      return [...workflows.values()].map(({ description, key, title }) => ({
        description,
        key,
        title,
      }));
    },

    async pauseSession(sessionId, pauseInput = {}) {
      await authorize(authz, {
        actor: pauseInput.actor,
        operation: "session.pause",
        target: { id: sessionId, kind: "session" },
      });
      const control = requireControl(sessions, sessionId, "pause");
      if (!control.pause) throw new Error(`Session ${sessionId} does not support pause.`);
      return control.pause({ reason: pauseInput.reason });
    },

    async rerunFromCheckpoint(rerunInput: RuntimeRerunInput) {
      await authorize(authz, {
        actor: rerunInput.actor,
        operation: "session.rerun",
        target: { id: rerunInput.sessionId, kind: "session" },
      });
      const control = requireControl(sessions, rerunInput.sessionId, "rerun");
      if (!control.rerunFromCheckpoint) {
        throw new Error(`Session ${rerunInput.sessionId} does not support checkpoint rerun.`);
      }
      return control.rerunFromCheckpoint({
        checkpointId: rerunInput.checkpointId,
        input: rerunInput.input,
        state: rerunInput.state,
      });
    },

    async resumeHook(hookInput) {
      const sessionId = sessionIdFromHookToken(hookInput.token);
      await authorize(authz, {
        actor: hookInput.actor,
        operation: "hook.resume",
        target: { id: hookInput.token, kind: "hook" },
      });
      const control = requireControl(sessions, sessionId, "hook resume");
      if (!control.resumeHook) throw new Error(`Session ${sessionId} does not support hook resume.`);
      return control.resumeHook({
        token: hookInput.token,
        value: hookInput.value,
      });
    },

    async resumeSession(sessionId, resumeInput = {}) {
      await authorize(authz, {
        actor: resumeInput.actor,
        operation: "session.resume",
        target: { id: sessionId, kind: "session" },
      });
      const control = requireControl(sessions, sessionId, "resume");
      if (!control.resume) throw new Error(`Session ${sessionId} does not support resume.`);
      return control.resume();
    },

    async startWorkflow(workflowKey: string, workflowInput: unknown, options: RuntimeStartOptions = {}) {
      return runRuntimeEffect(runtimeOperationEffect("workflow.start", async () => {
        const workflow = workflows.get(workflowKey);
        if (!workflow) throw new Error(`Unknown workflow: ${workflowKey}`);
        await authorize(authz, {
          actor: options.actor,
          operation: "workflow.start",
          target: { kind: "workflow", workflowKey },
        });
        const runId = options.runId ?? `run_${crypto.randomUUID()}`;
        const emitted: EventRecord[] = [];
        const result = await startRuntimeWorkflow(
          workflow,
          workflowInput,
          {
            ...options,
            runId,
            emit(event) {
              emitted.push(runtimeEvent(workflowKey, runId, emitted.length, event));
            },
          },
          (session, control) => sessions.save(session, control),
        );
        const session = {
          ...result.session,
          events: result.session.events.length > 0 ? result.session.events : emitted,
        };
        sessions.save(session, result.control);
        return sessions.get(session.runId)!;
      }));
    },

    streamEvents(sessionId: string, options: RuntimeEventStreamOptions & { actor?: unknown } = {}) {
      return eventStreamFromList(() => runtime.listEvents(sessionId, options), options.fromIndex);
    },
  };

  return runtime;
}

function normalizeWorkflows(
  input: CreateIntentRuntimeInput["workflows"],
): Map<string, RegisteredRuntimeWorkflow> {
  const values = Array.isArray(input)
    ? input.map((workflow) => {
        if (!workflow.key) throw new Error("Runtime workflow arrays require workflow.key.");
        return [workflow.key, workflow as RegisteredRuntimeWorkflow] as const;
      })
    : Object.entries(input).map(([key, workflow]) => [
        key,
        Object.assign({}, workflow, { key }) as RegisteredRuntimeWorkflow,
      ] as const);
  return new Map(values);
}

async function startRuntimeWorkflow(
  workflow: RegisteredRuntimeWorkflow,
  input: unknown,
  options: RuntimeStartOptions & { emit: (event: EventPayload) => void },
  save: (snapshot: RuntimeSessionSnapshot, control?: RuntimeSessionControl) => void,
) {
  if (isExplicitRuntimeWorkflow(workflow)) {
    const result = await workflow.start(input, options);
    return {
      control: result.control,
      session: result.session,
    };
  }
  const startableOptions = {
    answers: options.answers,
    onEvent: options.emit,
    runId: options.runId,
  };
  const session = await workflow.start(input, startableOptions);
  const control = controlFromStartable(workflow.key, input, session as RuntimeStartableSession, save);
  return {
    control,
    session: snapshotFromStartable(workflow.key, input, session as RuntimeStartableSession),
  };
}

function isExplicitRuntimeWorkflow(
  workflow: RegisteredRuntimeWorkflow,
): workflow is RuntimeWorkflow & { key: string } {
  return workflow.start.length <= 2 && !("graph" in workflow);
}

function addDefaultActions(actions: Map<string, RuntimeAction>, sessions: RuntimeSessionStore) {
  for (const action of [
    {
      key: "pause",
      title: "Pause session",
      available({ session }) {
        const control = sessions.getControl(session.runId);
        return control?.pause
          ? { status: "available" as const }
          : { reason: "Session does not support pause.", status: "unavailable" as const };
      },
      async run({ runtime, session, input }) {
        const next = await runtime.pauseSession(session.runId, input as { reason?: string } | undefined);
        return { actionKey: "pause", output: next, session: next, status: "accepted" as const };
      },
    },
    {
      key: "resume",
      title: "Resume session",
      available({ session }) {
        const control = sessions.getControl(session.runId);
        return control?.resume
          ? { status: "available" as const }
          : { reason: "Session does not support resume.", status: "unavailable" as const };
      },
      async run({ runtime, session }) {
        const next = await runtime.resumeSession(session.runId);
        return { actionKey: "resume", output: next, session: next, status: "accepted" as const };
      },
    },
    {
      key: "cancel",
      title: "Cancel session",
      available({ session }) {
        const control = sessions.getControl(session.runId);
        return control?.cancel
          ? { status: "available" as const }
          : { reason: "Session does not support cancellation.", status: "unavailable" as const };
      },
      async run({ runtime, session, input }) {
        const next = await runtime.cancelSession(session.runId, input as { reason?: string } | undefined);
        return { actionKey: "cancel", output: next, session: next, status: "accepted" as const };
      },
    },
    {
      key: "rerun-from-checkpoint",
      title: "Rerun from checkpoint",
      available({ session }) {
        const control = sessions.getControl(session.runId);
        return control?.rerunFromCheckpoint
          ? { status: "available" as const }
          : { reason: "Session does not support checkpoint rerun.", status: "unavailable" as const };
      },
      async run({ runtime, session, input }) {
        const body = input && typeof input === "object" && !Array.isArray(input)
          ? input as { checkpointId?: string; input?: unknown; state?: Record<string, unknown> }
          : {};
        if (!body.checkpointId) {
          return rejectedAction("rerun-from-checkpoint", "BAD_REQUEST", "Missing checkpointId.");
        }
        const next = await runtime.rerunFromCheckpoint({
          checkpointId: body.checkpointId,
          input: body.input,
          sessionId: session.runId,
          state: body.state,
        });
        return { actionKey: "rerun-from-checkpoint", output: next, session: next, status: "accepted" as const };
      },
    },
  ] satisfies RuntimeAction[]) {
    if (!actions.has(action.key)) {
      actions.set(action.key, action);
    }
  }
}

async function authorize(authz: RuntimeAuthz | undefined, input: RuntimeAuthzInput) {
  if (!authz) return;
  const decision = await authz(input);
  if (!decision.ok) {
    throw new Error(decision.reason ?? `Unauthorized runtime operation: ${input.operation}`);
  }
}

function requireControl(store: RuntimeSessionStore, sessionId: string, action: string) {
  const control = store.getControl(sessionId);
  if (!control) throw new Error(`Session ${sessionId} does not support ${action}.`);
  return control;
}

function runtimeEvent(
  workflowKey: string,
  runId: string | undefined,
  index: number,
  event: EventPayload,
): EventRecord {
  const eventRunId = runId ?? event.runId ?? `runtime_${crypto.randomUUID()}`;
  return {
    ...event,
    correlationId: event.correlationId ?? `run:${eventRunId}:event:${index}`,
    index,
    message: event.message,
    runId: eventRunId,
    timestamp: new Date().toISOString(),
    type: event.type ?? `${workflowKey}.event`,
  };
}

function sessionIdFromHookToken(token: string) {
  if (token.startsWith("question:")) {
    const [, runId] = token.split(":");
    if (runId) return runId;
  }
  if (token.startsWith("hook:")) {
    const [, runId] = token.split(":");
    if (runId) return runId;
  }
  throw new Error(`Cannot determine session id from hook token: ${token}`);
}

function rejectedAction(actionKey: string, code: string, message: string) {
  return {
    actionKey,
    error: { code, message },
    status: "rejected" as const,
  };
}

export type {
  RuntimeWorkflowDescriptor,
};
