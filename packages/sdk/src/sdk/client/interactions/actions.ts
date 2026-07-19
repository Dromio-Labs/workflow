import type { IntentClient } from "../transport/index.js";
import type {
  RuntimeActionDescriptor,
  RuntimeActionResult,
  RuntimeRerunInput,
  RuntimeSessionSnapshot,
} from "../../core/runtime/index.js";
import type {
  InteractionAction,
  InteractionActions,
} from "./interaction.types.js";

export function projectActions(actions: RuntimeActionDescriptor[]): InteractionAction[] {
  return actions.map((action) => ({
    ...action,
    available: action.status === "available",
  }));
}

export function createInteractionActions(input: {
  client: IntentClient;
  getSession: () => RuntimeSessionSnapshot;
  onSession: (session: RuntimeSessionSnapshot) => void;
}): InteractionActions {
  let descriptors: RuntimeActionDescriptor[] = [];
  const apply = async (actionKey: string, actionInput?: unknown): Promise<RuntimeActionResult> => {
    const result = await input.client.sessions.applyAction({
      actionKey,
      input: actionInput,
      sessionId: input.getSession().runId,
    });
    if (result.session) input.onSession(result.session);
    return result;
  };
  return {
    get descriptors() {
      return projectActions(descriptors);
    },
    apply,
    cancel(actionInput) {
      return apply("cancel", actionInput);
    },
    pause(actionInput) {
      return apply("pause", actionInput);
    },
    rerunFromCheckpoint(rerunInput: Omit<RuntimeRerunInput, "sessionId">) {
      return apply("rerun-from-checkpoint", rerunInput);
    },
    resume() {
      return apply("resume");
    },
    update(next) {
      descriptors = next;
    },
  };
}
