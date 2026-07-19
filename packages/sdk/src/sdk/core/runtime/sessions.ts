import type {
  EventRecord,
  LoopCheckpoint,
  LoopStartOptions,
  HookRequest,
} from "../loop/index.js";
import type {
  RuntimeSessionControl,
  RuntimeSessionSnapshot,
  RuntimeStartableSession,
} from "./runtime.types.js";
import {
  runRuntimeEffect,
  runtimeOperationEffect,
} from "./effects.js";

export function snapshotFromStartable(
  workflowKey: string,
  input: unknown,
  session: RuntimeStartableSession,
): RuntimeSessionSnapshot {
  return {
    checkpoints: cloneList(session.checkpoints),
    events: cloneList(session.events),
    input: session.input ?? input,
    parentCheckpointId: session.parentCheckpointId,
    parentRunId: session.parentRunId,
    pendingHooks: cloneList(session.pendingHooks),
    pendingQuestions: cloneList(session.pendingQuestions),
    runId: session.runId,
    state: cloneRecord(session.state),
    status: session.status,
    workflowKey,
  };
}

export function controlFromStartable(
  workflowKey: string,
  input: unknown,
  session: RuntimeStartableSession,
  save: (snapshot: RuntimeSessionSnapshot, control?: RuntimeSessionControl) => void,
): RuntimeSessionControl {
  const snapshot = () => {
    const next = snapshotFromStartable(workflowKey, input, session);
    save(next, control);
    return next;
  };
  const control: RuntimeSessionControl = {
    async answer(answerInput) {
      return runRuntimeEffect(runtimeOperationEffect("session.answer", async () => {
        if (!session.answer) throw new Error(`Session ${session.runId} does not support answers.`);
        await session.answer(answerInput);
        return snapshot();
      }));
    },
    async cancel(cancelInput) {
      return runRuntimeEffect(runtimeOperationEffect("session.cancel", async () => {
        if (!session.cancel) throw new Error(`Session ${session.runId} does not support cancellation.`);
        await session.cancel(cancelInput);
        return snapshot();
      }));
    },
    async pause(pauseInput) {
      return runRuntimeEffect(runtimeOperationEffect("session.pause", async () => {
        if (!("pause" in session) || typeof session.pause !== "function") {
          throw new Error(`Session ${session.runId} does not support pause.`);
        }
        await session.pause(pauseInput);
        return snapshot();
      }));
    },
    async resume() {
      return runRuntimeEffect(runtimeOperationEffect("session.resume", async () => {
        await session.resume();
        return snapshot();
      }));
    },
    async resumeHook(hookInput) {
      return runRuntimeEffect(runtimeOperationEffect("session.resumeHook", async () => {
        if (!session.resumeHook) throw new Error(`Session ${session.runId} does not support hook resume.`);
        await session.resumeHook(hookInput);
        return snapshot();
      }));
    },
    async rerunFromCheckpoint(rerunInput) {
      return runRuntimeEffect(runtimeOperationEffect("session.rerunFromCheckpoint", async () => {
        if (!session.rerunFromCheckpoint) {
          throw new Error(`Session ${session.runId} does not support checkpoint rerun.`);
        }
        const child = await session.rerunFromCheckpoint(rerunInput as LoopStartOptions & {
          checkpointId: string;
          input?: unknown;
          state?: Record<string, unknown>;
        });
        const childControl = controlFromStartable(
          workflowKey,
          rerunInput.input ?? input,
          child,
          save,
        );
        const childSnapshot = snapshotFromStartable(workflowKey, rerunInput.input ?? input, child);
        save(childSnapshot, childControl);
        return childSnapshot;
      }));
    },
  };
  return control;
}

export function cloneSnapshot<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

function cloneList<T extends EventRecord | HookRequest | LoopCheckpoint<unknown> | unknown>(value: T[]): T[] {
  return cloneSnapshot(value);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return cloneSnapshot(value);
}
