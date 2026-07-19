import type {
  RuntimeAction,
  RuntimeActionContext,
  RuntimeActionDescriptor,
} from "./runtime.types.js";

export function normalizeActions(
  actions: RuntimeAction[] | Record<string, RuntimeAction> | undefined,
): Map<string, RuntimeAction> {
  const entries = Array.isArray(actions)
    ? actions.map((action) => [action.key, action] as const)
    : Object.entries(actions ?? {});
  return new Map(entries);
}

export async function actionDescriptor(
  action: RuntimeAction,
  context: RuntimeActionContext,
): Promise<RuntimeActionDescriptor> {
  const availability = action.available
    ? await action.available(context)
    : { status: "available" as const };
  return {
    description: action.description,
    key: action.key,
    reason: availability.reason,
    status: availability.status,
    title: action.title,
  };
}
