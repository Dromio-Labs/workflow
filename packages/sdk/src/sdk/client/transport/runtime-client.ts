import type {
  CreateRunInput,
  IntentClient,
} from "./client.types.js";
import type { IntentRuntime } from "../../core/runtime/index.js";

export function createRuntimeClient(runtime: IntentRuntime): IntentClient {
  return {
    artifacts: {
      async upload() {
        throw new Error("Artifact uploads require an HTTP client with configured artifact routes.");
      },
      url() {
        throw new Error("Artifact URLs require an HTTP client with a base URL.");
      },
    },
    hooks: {
      resume(input) {
        return runtime.resumeHook(input);
      },
    },
    runs: {
      async create(input: CreateRunInput) {
        return {
          session: await runtime.startWorkflow(input.workflow, input.input, {
            answers: input.answers,
            runId: input.runId,
          }),
        };
      },
    },
    sessions: {
      actions(sessionId) {
        return runtime.listActions(sessionId);
      },
      applyAction(input) {
        return runtime.applyAction(input);
      },
      checkpoints(sessionId) {
        return runtime.listCheckpoints(sessionId);
      },
      events(sessionId, input = {}) {
        return runtime.listEvents(sessionId, input);
      },
      get(sessionId) {
        return runtime.getSession(sessionId);
      },
      list() {
        return runtime.listSessions();
      },
      rerun(input) {
        return runtime.rerunFromCheckpoint(input);
      },
      streamEvents(sessionId, input = {}) {
        return runtime.streamEvents(sessionId, input);
      },
    },
    workflows: {
      list() {
        return runtime.listWorkflows();
      },
    },
  };
}
