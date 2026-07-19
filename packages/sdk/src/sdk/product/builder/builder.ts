import type {
  IntentContract,
  IntentRequirement,
  IntentStep,
} from "../intent/index.js";
import type {
  Capability,
  CapabilityCatalog,
  CapabilityMatchContext,
  PlanItem,
} from "./builder.types.js";

export function capability<const TIntentId extends string>(
  input: Capability<TIntentId>,
): Capability<TIntentId> {
  return input;
}

export function capabilities(input: { items: Capability[] }): CapabilityCatalog {
  return {
    items: input.items,
    async match(intent) {
      const missingQuestions = intent.requirements.flatMap((requirement) =>
        requirement.required && requirement.status !== "satisfied" && requirement.question
          ? [requirement.question]
          : [],
      );
      if (missingQuestions.length > 0) {
        return {
          missingCapabilities: [],
          plan: { edges: [], items: [] },
          questions: missingQuestions,
        };
      }

      const requirements = new Map(intent.requirements.map((item) => [item.id, item]));
      const missingCapabilities = orderedIntentSteps(intent, input.items)
        .filter((intentStep) => !selectCapability(input.items, intentStep, intent, requirements))
        .map((intentStep) => ({
          intent: intentStep.intent,
          label: intentStep.label,
          stepId: intentStep.id,
        }));
      const items = plannedItems(input.items, intent);
      const edges = items.slice(1).map((item, index) => ({
        from: items[index].id,
        id: `edge_${items[index].id}_${item.id}`,
        to: item.id,
      }));
      return {
        missingCapabilities,
        plan: { edges, items },
        questions: [],
      };
    },
  };
}

function plannedItems(capabilityItems: Capability[], intent: IntentContract): PlanItem[] {
  const requirements = new Map(intent.requirements.map((item) => [item.id, item]));
  return orderedIntentSteps(intent, capabilityItems).flatMap((intentStep) => {
    const selected = selectCapability(capabilityItems, intentStep, intent, requirements);
    if (!selected) {
      return [];
    }
    const context = createMatchContext(intentStep, intent, requirements);
    return [
      {
        capabilityId: selected.id,
        id: planItemId(intentStep),
        input: selected.mapInput?.(context) ?? {},
        intent: intentStep.intent,
        kind: intentStep.intent === "trigger" ? "trigger" : "action",
        title: selected.title,
      },
    ];
  });
}

function planItemId(step: IntentStep) {
  return `node_${slugId(step.id || step.intent)}`;
}

function slugId(value: string) {
  const slug = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || "step";
}

function orderedIntentSteps(intent: IntentContract, capabilityItems: Capability[]) {
  const intentOrder = new Map<string, number>();
  for (const item of capabilityItems) {
    if (item.order === undefined || intentOrder.has(item.intent)) {
      continue;
    }
    intentOrder.set(item.intent, item.order);
  }
  return [...intent.steps].sort(
    (left, right) => {
      const leftOrder = intentOrder.get(left.intent) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = intentOrder.get(right.intent) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return intent.steps.indexOf(left) - intent.steps.indexOf(right);
    },
  );
}

function selectCapability(
  capabilityItems: Capability[],
  step: IntentStep,
  intent: IntentContract,
  requirements: Map<string, IntentRequirement>,
) {
  const context = createMatchContext(step, intent, requirements);
  return capabilityItems.find((item) => {
    if (item.intent !== step.intent) return false;
    return item.match ? item.match(context) : true;
  });
}

function createMatchContext(
  step: IntentStep,
  intent: IntentContract,
  requirements: Map<string, IntentRequirement>,
) {
  return {
    intent,
    requirement(id: string) {
      return requirements.get(id);
    },
    requirementValue(ids: string | string[], defaultValue?: unknown) {
      return valueFor(requirements, Array.isArray(ids) ? ids : [ids], defaultValue);
    },
    requirements,
    step,
  };
}

function valueFor(
  requirements: Map<string, IntentRequirement>,
  ids: string[],
  defaultValue?: unknown,
) {
  for (const id of ids) {
    const value = requirements.get(id)?.value;
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return defaultValue;
}
